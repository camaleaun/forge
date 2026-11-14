// The platform adapter of the language loader. i18n_common.cpp holds all of the logic; each platform
// (i18n_macos.mm, i18n_linux.cpp) implements these few functions and nothing else.
#pragma once
#include <cstddef>
#include <string>
#include <vector>

namespace forge_app::platform {

// The user's settings. Keys: "language" (a tag; absent = Auto) and "download" ("false" turns downloads off).
bool read_setting(const char* key, std::string& value);
void write_setting(const char* key, const std::string& value);  // an empty value removes the key

// The user's languages, most preferred first (BCP 47 or POSIX spelling).
std::vector<std::string> system_languages();

// The directory of the language packs when FORGE_I18N_CACHE_DIR is not set.
std::string cache_base();

struct Http {
  long status = 0;   // the final HTTP status; a refused redirect leaves the 3xx
  std::string body;  // the body of that answer
  std::string error;  // set when http_get returns false
};
using UrlAllowed = bool (*)(const std::string& url);
// Called while a body arrives, possibly from the worker thread: the bytes received so far and the total
// (0 when the server sent no length). It never runs after http_get returns.
using Progress = void (*)(void* context, std::size_t received, std::size_t total);

// One blocking GET with the given timeouts. Redirects are followed, and `allowed` must approve every
// hop (a refused hop stops there: the 3xx is the answer). A body above `max_bytes` is an error.
// `progress` (optional) reports the body of the final answer.
bool http_get(const std::string& url, std::size_t max_bytes, int request_ms, int resource_ms, UrlAllowed allowed, Http& out,
              Progress progress = nullptr, void* context = nullptr);

// Runs `work` on another thread, then `done` on the main (UI) thread; both receive `context`.
void run_in_background(void (*work)(void*), void (*done)(void*), void* context);

// Runs `fn` on the main (UI) thread; callable from any thread. Used to carry download progress.
void post_to_main(void (*fn)(void*), void* context);

}  // namespace forge_app::platform
