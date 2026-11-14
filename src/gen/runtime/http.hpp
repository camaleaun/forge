// A small blocking HTTP client for the native runtime. Call it from a worker thread.
// API shape inspired by the HTTP helper of WordPress (WP_Http, wp_remote_*); original implementation, MIT.
//
// Fixed rules, with no switch to loosen them: TLS is always verified; only https is used, plus http to
// loopback (127.0.0.0/8, ::1, localhost) so tests can run; an https answer never redirects to http; every
// redirect hop must pass `allowed` and the https/loopback rule (a refused hop returns the 3xx as is);
// header names and values and the method must not contain CR or LF; no credentials, cookies or cache.
#pragma once
#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace forge::remote {

struct Header {
  std::string name, value;
};

// Called while a body arrives, possibly from the worker thread: the bytes received so far and the total
// (0 when the server sent no length). It never runs after request() returns.
using Progress = void (*)(void* context, std::size_t received, std::size_t total);
using UrlAllowed = bool (*)(const std::string& url);

struct Args {
  std::string method = "GET";
  int timeout_ms = 5000;            // connect and idle time
  int resource_timeout_ms = 60000;  // the whole request, redirects included
  int redirection = 5;              // hops that may be followed
  std::string user_agent;           // empty: forge/<app version or "unknown">
  std::vector<Header> headers;
  std::string body;
  std::size_t limit_response_size = 8u << 20;
  UrlAllowed allowed = nullptr;  // asked about every redirect hop
  Progress progress = nullptr;
  void* context = nullptr;
};

struct Response {
  int code = 0;
  std::string message;
  std::vector<Header> headers;
  std::string body;
};

// Error codes: invalid_url, invalid_header, refused_url, too_many_redirects, too_large, timeout, tls, network.
struct Error {
  std::string code;
  std::string message;
};

struct Result {
  Response response;
  Error error;
  bool ok() const { return error.code.empty(); }
};

Result request(const std::string& url, const Args& args = {});
Result get(const std::string& url, Args args = {});
Result post(const std::string& url, Args args = {});
Result head(const std::string& url, Args args = {});

int response_code(const Result& result);
const std::string& response_body(const Result& result);
std::string response_header(const Result& result, std::string_view name);  // case-insensitive

}  // namespace forge::remote
