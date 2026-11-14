// The platform adapter of forge::remote. http_common.cpp holds all of the policy; each platform
// (http_macos.mm, http_linux.cpp, later http_windows.cpp) implements this one function and nothing else.
#pragma once
#include <cstddef>
#include <string>
#include <vector>

#include "http.hpp"

namespace forge::remote::adapter {

// One HTTP exchange: connect, send, read. It never follows a redirect, keeps no cookies, credentials or
// cache, and verifies TLS. Redirects, limits and progress are the policy's job.
struct Exchange {
  const std::string* method;
  const std::string* url;
  const std::vector<Header>* headers;  // complete: includes User-Agent
  const std::string* body;
  int timeout_ms;   // connect and idle time
  int resource_ms;  // the time left for this exchange as a whole
  // Called once with the status line and headers. Returning false stops the exchange (success, no body).
  bool (*on_head)(void* context, int code, const std::string& message, const std::vector<Header>& headers);
  // Called for each piece of the body. Returning false stops the exchange (success).
  bool (*on_data)(void* context, const char* data, std::size_t size);
  void* context;
};

// Returns an empty code when the exchange completed or was stopped by a callback; otherwise timeout, tls
// or network (with a message).
Error exchange(const Exchange& exchange);

}  // namespace forge::remote::adapter
