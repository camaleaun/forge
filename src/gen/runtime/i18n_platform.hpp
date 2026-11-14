// The platform adapter of the language loader. i18n_common.cpp holds all of the logic; each platform
// (i18n_macos.mm, i18n_linux.cpp) implements these few functions and nothing else.
#pragma once
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

// Runs `work` on another thread, then `done` on the main (UI) thread; both receive `context`.
void run_in_background(void (*work)(void*), void (*done)(void*), void* context);

// Runs `fn` on the main (UI) thread; callable from any thread. Used to carry download progress.
void post_to_main(void (*fn)(void*), void* context);

}  // namespace forge_app::platform
