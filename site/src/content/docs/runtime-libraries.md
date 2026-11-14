---
title: Runtime libraries
description: "The small C++ libraries that forge copies into a native build only when the app needs them, starting with forge::remote, a blocking HTTP client."
order: 8
---

# Runtime libraries

Generated apps are tiny because forge copies a runtime file into the build only when the app uses it. A plain hello carries none of the libraries below.

## forge::remote (HTTP)

`forge::remote` is a small blocking HTTP client for native apps. Today it is built into apps that have language packs, which download them with it. It uses NSURLSession on macOS and libsoup 3 on Linux (a Windows adapter will use WinHTTP). The files are `http.hpp` (the API), `http_common.cpp` (the policy, shared by all platforms), `http_macos.mm` and `http_linux.cpp` (the adapters), and a private `http_adapter.hpp` between them.

```cpp
#include "http.hpp"

forge::remote::Args args;
args.timeout_ms = 5000;
args.limit_response_size = 1u << 20;
args.headers.push_back({"Accept", "application/json"});
forge::remote::Result result = forge::remote::get("https://example.com/data.json", args);
if (result.ok() && forge::remote::response_code(result) == 200) use(forge::remote::response_body(result));
else report(result.error.code);  // timeout, tls, too_large, ...
```

The calls block, so run them on a worker thread. There is `request`, `get`, `post` and `head`; `response_code`, `response_body` and `response_header` (the name is case-insensitive) read a result. A failure sets `error.code` to one of `invalid_url`, `invalid_header`, `refused_url`, `too_many_redirects`, `too_large`, `timeout`, `tls` or `network`.

The security rules are fixed; there are no switches to loosen them:

- TLS is always verified.
- Only `https` is allowed, plus `http` to loopback (`127.0.0.0/8`, `::1`, `localhost`) so tests can run.
- A redirect never goes from `https` to `http`. Every hop must pass the https and loopback rule and the optional `allowed` callback; a refused hop returns the 3xx answer as it is. `Authorization` and `Cookie` headers are not sent to another host.
- A header name, a header value or the method with a CR or LF is rejected before anything is sent.
- No credentials, cookies or cache are kept.
- The response size limit is enforced while the body arrives, and the timeouts map to the `timeout` error.
