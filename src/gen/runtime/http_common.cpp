// The portable policy of forge::remote: URL and header checks, the https/loopback rule, redirects, the size
// cap and progress. Each platform adapter (http_adapter.hpp) only performs one exchange.
#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdlib>
#include <initializer_list>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "http.hpp"
#include "http_adapter.hpp"

#if __has_include("forge_app.hpp")
#include "forge_app.hpp"
#define FORGE_HTTP_VERSION forge_app::APP_VERSION
#else
#define FORGE_HTTP_VERSION ""
#endif

namespace forge::remote {
namespace {

std::string lower(std::string text) {
  for (char& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return text;
}

bool same_name(const std::string& a, std::string_view b) {
  if (a.size() != b.size()) return false;
  for (std::size_t i = 0; i < a.size(); ++i)
    if (std::tolower(static_cast<unsigned char>(a[i])) != std::tolower(static_cast<unsigned char>(b[i]))) return false;
  return true;
}

bool has_header(const std::vector<Header>& headers, std::string_view name) {
  return std::any_of(headers.begin(), headers.end(), [&](const Header& h) { return same_name(h.name, name); });
}

void drop_headers(std::vector<Header>& headers, std::initializer_list<std::string_view> names) {
  headers.erase(std::remove_if(headers.begin(), headers.end(),
                               [&](const Header& h) { return std::any_of(names.begin(), names.end(), [&](std::string_view n) { return same_name(h.name, n); }); }),
                headers.end());
}

bool token(const std::string& text) {
  if (text.empty()) return false;
  for (unsigned char c : text)
    if (c <= 0x20 || c >= 0x7f || std::string("()<>@,;:\\\"/[]?={}").find(static_cast<char>(c)) != std::string::npos) return false;
  return true;
}

bool clean_value(const std::string& text) {
  return text.find_first_of(std::string("\r\n\0", 3)) == std::string::npos;
}

struct Url {
  std::string scheme, authority, host, rest;  // rest: the path, query and fragment ("" or starts with / ? #)
  bool valid = false;
};

Url parse(const std::string& text) {
  Url url;
  for (unsigned char c : text)
    if (c <= 0x20 || c == 0x7f) return url;
  const std::size_t colon = text.find("://");
  if (colon == std::string::npos) return url;
  url.scheme = lower(text.substr(0, colon));
  if (url.scheme != "http" && url.scheme != "https") return url;
  const std::size_t start = colon + 3, end = text.find_first_of("/?#", start);
  url.authority = text.substr(start, end == std::string::npos ? std::string::npos : end - start);
  url.rest = end == std::string::npos ? "" : text.substr(end);
  std::string at = url.authority;
  if (const std::size_t sign = at.rfind('@'); sign != std::string::npos) at.erase(0, sign + 1);
  url.host = !at.empty() && at[0] == '[' ? at.substr(1, at.find(']') - 1) : at.substr(0, at.find(':'));
  url.host = lower(url.host);
  url.valid = !url.host.empty();
  return url;
}

bool loopback(const std::string& host) {
  if (host == "localhost" || host == "::1") return true;
  return host.compare(0, 4, "127.") == 0 && host.find_first_not_of("0123456789.") == std::string::npos;
}

bool permitted(const Url& url) { return url.scheme == "https" || loopback(url.host); }

// Resolves a Location header against the URL that answered.
std::string resolve(const Url& base, const std::string& location) {
  if (location.find("://") != std::string::npos) return location;
  const std::string origin = base.scheme + "://";
  if (location.compare(0, 2, "//") == 0) return base.scheme + ":" + location;
  if (!location.empty() && location[0] == '/') return origin + base.authority + location;
  std::string path = base.rest.substr(0, base.rest.find_first_of("?#"));
  path.erase(path.rfind('/') == std::string::npos ? 0 : path.rfind('/') + 1);
  return origin + base.authority + (path.empty() ? "/" : path) + location;
}

const char* reason(int code) {
  switch (code) {
    case 200: return "OK";
    case 201: return "Created";
    case 202: return "Accepted";
    case 204: return "No Content";
    case 301: return "Moved Permanently";
    case 302: return "Found";
    case 303: return "See Other";
    case 304: return "Not Modified";
    case 307: return "Temporary Redirect";
    case 308: return "Permanent Redirect";
    case 400: return "Bad Request";
    case 401: return "Unauthorized";
    case 403: return "Forbidden";
    case 404: return "Not Found";
    case 405: return "Method Not Allowed";
    case 410: return "Gone";
    case 429: return "Too Many Requests";
    case 500: return "Internal Server Error";
    case 502: return "Bad Gateway";
    case 503: return "Service Unavailable";
    case 504: return "Gateway Timeout";
    default: return "";
  }
}

Error failure(const char* code, const char* message) { return {code, message}; }

struct State {
  const Args* args;
  bool head;
  Response response;
  std::string location;
  bool redirect = false;
  bool too_large = false;
  std::size_t total = 0;
};

bool on_head(void* context, int code, const std::string& message, const std::vector<Header>& headers) {
  State& state = *static_cast<State*>(context);
  state.response.code = code;
  state.response.message = message.empty() ? reason(code) : message;
  state.response.headers = headers;
  state.response.body.clear();
  state.location.clear();
  for (const Header& h : headers) {
    if (same_name(h.name, "location")) state.location = h.value;
    if (same_name(h.name, "content-length")) state.total = static_cast<std::size_t>(std::strtoull(h.value.c_str(), nullptr, 10));
  }
  state.redirect = (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) && !state.location.empty();
  if (state.redirect) return false;  // the policy decides; the body is not read
  if (!state.head && state.total > state.args->limit_response_size) {
    state.too_large = true;
    return false;
  }
  if (state.args->progress) state.args->progress(state.args->context, 0, state.total);
  return true;
}

bool on_data(void* context, const char* data, std::size_t size) {
  State& state = *static_cast<State*>(context);
  if (state.response.body.size() + size > state.args->limit_response_size) {
    state.too_large = true;
    return false;
  }
  state.response.body.append(data, size);
  if (state.args->progress) state.args->progress(state.args->context, state.response.body.size(), state.total);
  return true;
}

}  // namespace

Result request(const std::string& first_url, const Args& args) {
  Result result;
  auto fail = [&](Error error) {
    result.response = Response();
    result.error = std::move(error);
    return result;
  };
  std::string method = args.method;
  if (!token(method)) return fail(failure("invalid_url", "the method is not valid"));
  for (const Header& h : args.headers)
    if (!token(h.name) || !clean_value(h.value)) return fail(failure("invalid_header", "a header name or value is not valid"));
  Url url = parse(first_url);
  if (!url.valid) return fail(failure("invalid_url", "the URL is not valid"));
  if (!permitted(url) || (args.allowed && !args.allowed(first_url))) return fail(failure("refused_url", "https is required (http only to loopback)"));

  std::vector<Header> headers = args.headers;
  if (!has_header(headers, "user-agent")) {
    const std::string version = FORGE_HTTP_VERSION;
    headers.push_back({"User-Agent", !args.user_agent.empty() ? args.user_agent : "forge/" + (version.empty() ? std::string("unknown") : version)});
  }
  if (!has_header(headers, "accept-encoding")) headers.push_back({"Accept-Encoding", "identity"});
  std::string body = args.body, current = first_url;
  const auto start = std::chrono::steady_clock::now();

  for (int hop = 0;; ++hop) {
    const long long elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count();
    if (elapsed >= args.resource_timeout_ms) return fail(failure("timeout", "the request timed out"));
    State state{&args, method == "HEAD", {}, {}};
    adapter::Exchange exchange{&method, &current, &headers, &body, args.timeout_ms, static_cast<int>(args.resource_timeout_ms - elapsed), on_head, on_data, &state};
    Error error = adapter::exchange(exchange);
    if (state.too_large) return fail(failure("too_large", "the response is larger than allowed"));
    if (!error.code.empty()) return fail(std::move(error));
    if (state.redirect) {
      const std::string next = resolve(url, state.location);
      const Url target = parse(next);
      const bool downgrade = url.scheme == "https" && target.scheme == "http";
      if (!target.valid || downgrade || !permitted(target) || (args.allowed && !args.allowed(next))) {  // refused: the 3xx is the answer
        result.response = std::move(state.response);
        return result;
      }
      if (hop >= args.redirection) return fail(failure("too_many_redirects", "too many redirects"));
      if (target.authority != url.authority) drop_headers(headers, {"authorization", "cookie", "proxy-authorization"});
      const int code = state.response.code;
      if (method != "GET" && method != "HEAD" && (code == 303 || code == 301 || code == 302)) {
        method = "GET";
        body.clear();
        drop_headers(headers, {"content-type", "content-length", "content-encoding"});
      }
      url = target;
      current = next;
      continue;
    }
    result.response = std::move(state.response);
    return result;
  }
}

Result get(const std::string& url, Args args) {
  args.method = "GET";
  return request(url, args);
}
Result post(const std::string& url, Args args) {
  args.method = "POST";
  return request(url, args);
}
Result head(const std::string& url, Args args) {
  args.method = "HEAD";
  return request(url, args);
}

int response_code(const Result& result) { return result.response.code; }
const std::string& response_body(const Result& result) { return result.response.body; }
std::string response_header(const Result& result, std::string_view name) {
  std::string out;
  for (const Header& h : result.response.headers) {
    if (!same_name(h.name, name)) continue;
    out += (out.empty() ? "" : ", ") + h.value;
  }
  return out;
}

}  // namespace forge::remote
