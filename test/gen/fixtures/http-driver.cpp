// A command-line driver for forge::remote. Usage: http-driver METHOD URL [key=value ...] with the keys
// limit, redirection, timeout, ua, header (Name: value, repeatable), body, deny (refuse URLs that
// contain this text), progress (1), lookup (print that response header). It prints one fact per line: code,
// message, error, H (response header), L (lookup), P (progress), BODY (the rest of the output is the body).
#include <cstdio>
#include <cstdlib>
#include <string>

#include "http.hpp"

namespace {
std::string g_deny;
bool allowed(const std::string& url) { return url.find(g_deny) == std::string::npos; }
void progress(void*, std::size_t received, std::size_t total) { std::printf("P %zu %zu\n", received, total); }
}  // namespace

int main(int argc, char** argv) {
  if (argc < 3) return 2;
  forge::remote::Args args;
  args.method = argv[1];
  std::string lookup;
  for (int i = 3; i < argc; ++i) {
    const std::string arg = argv[i];
    const std::size_t eq = arg.find('=');
    const std::string key = arg.substr(0, eq), value = eq == std::string::npos ? "" : arg.substr(eq + 1);
    if (key == "limit") args.limit_response_size = std::strtoul(value.c_str(), nullptr, 10);
    else if (key == "redirection") args.redirection = std::atoi(value.c_str());
    else if (key == "timeout") args.timeout_ms = args.resource_timeout_ms = std::atoi(value.c_str());
    else if (key == "ua") args.user_agent = value;
    else if (key == "body") args.body = value;
    else if (key == "lookup") lookup = value;
    else if (key == "deny") {
      g_deny = value;
      args.allowed = allowed;
    } else if (key == "progress") args.progress = progress;
    else if (key == "header") {
      const std::size_t colon = value.find(':');
      std::string text = value.substr(colon + 1);
      if (!text.empty() && text[0] == ' ') text.erase(0, 1);
      args.headers.push_back({value.substr(0, colon), text});
    }
  }
  const forge::remote::Result result = forge::remote::request(argv[2], args);
  std::printf("code %d\nmessage %s\nerror %s\n", result.response.code, result.response.message.c_str(), result.error.code.c_str());
  for (const forge::remote::Header& header : result.response.headers) std::printf("H %s: %s\n", header.name.c_str(), header.value.c_str());
  if (!lookup.empty()) std::printf("L %s\n", forge::remote::response_header(result, lookup).c_str());
  std::printf("BODY\n%s", forge::remote::response_body(result).c_str());
  return 0;
}
