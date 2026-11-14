// A scripted adapter for forge::remote: the portable policy (http_common.cpp) runs against it on any machine.
// FORGE_FAKE_MAP holds lines "URL|STATUS|LOCATION|BODY" (the last two optional); an unmapped URL answers 200 "ok".
// Every exchange is printed: X METHOD URL, XH name: value, XB body.
#include <cstdio>
#include <cstdlib>
#include <sstream>
#include <string>
#include <vector>

#include "http_adapter.hpp"

namespace forge::remote::adapter {

Error exchange(const Exchange& ex) {
  std::printf("X %s %s\n", ex.method->c_str(), ex.url->c_str());
  for (const Header& header : *ex.headers) std::printf("XH %s: %s\n", header.name.c_str(), header.value.c_str());
  if (!ex.body->empty()) std::printf("XB %s\n", ex.body->c_str());
  int status = 200;
  std::string location, body = "ok";
  std::istringstream map(std::getenv("FORGE_FAKE_MAP") ? std::getenv("FORGE_FAKE_MAP") : "");
  for (std::string line; std::getline(map, line);) {
    std::vector<std::string> parts;
    std::istringstream fields(line);
    for (std::string field; std::getline(fields, field, '|');) parts.push_back(field);
    if (parts.size() < 2 || parts[0] != *ex.url) continue;
    status = std::atoi(parts[1].c_str());
    location = parts.size() > 2 ? parts[2] : "";
    if (parts.size() > 3) body = parts[3];
  }
  std::vector<Header> headers;
  if (!location.empty()) headers.push_back({"Location", location});
  headers.push_back({"Content-Length", std::to_string(body.size())});
  if (!ex.on_head(ex.context, status, "", headers)) return {};
  if (*ex.method == "HEAD") return {};
  ex.on_data(ex.context, body.data(), body.size());
  return {};
}

}  // namespace forge::remote::adapter
