// Shared by generated apps that have language packs: the message tables of messages.cpp, the Text value
// that actions and UIs pass around, and the language loader (selection, cache, download).
#pragma once
#include <string>
#include <vector>

namespace forge_app {

// Defined by the generated messages.cpp.
struct MessageDef {
  const char* context;  // nullptr = none
  const char* text;     // English (the singular form for plural messages)
  const char* plural;   // English plural, nullptr = not a plural message
};
struct PackDef {
  const char* tag;
  const char* file;
  const char* sha256;
  unsigned size;
};
extern const MessageDef MESSAGES[];
extern const int MSG_COUNT;
extern const PackDef PACKS[];
extern const int PACK_COUNT;
extern const char* const PACK_BASE_URL;
extern const char* const APP_ID;
extern const bool DOWNLOAD_ENABLED;
extern const bool MENU_ENABLED;

// What the app shows: an English literal, a literal looked up in the pack (built-in texts), or a
// message of MESSAGES with its count and arguments.
struct Text {
  const char* literal = nullptr;
  bool translate = false;
  int message = -1;
  long count = 0;
  std::vector<std::string> args;

  Text() = default;
  Text(const char* text) : literal(text) {}
  static Text tr(const char* text) {
    Text t(text);
    t.translate = true;
    return t;
  }
  static Text msg(int index, long count = 0, std::vector<std::string> args = {}) {
    Text t;
    t.message = index;
    t.count = count;
    t.args = std::move(args);
    return t;
  }
};

// The text in the active language, English when there is no pack or no translation.
std::string render(const Text& text);

// GUI: called (on the main thread) whenever the active language or a pack's availability changes.
void set_refresh_hook(void (*hook)());
// Picks the language (FORGE_LOCALE_PREFERENCE, then the ForgeLanguage default, then the system) and applies
// a cached pack at once; a missing pack is downloaded in the background (one attempt per launch).
void start_gui_language();
// value: "" = Auto (system language), "en" = English, or a pack tag.
void choose_language(const std::string& value);
std::string stored_language();                    // "" = Auto
std::string active_language();                    // "en" or the tag of the pack in use
bool language_offline(const std::string& tag);    // its pack is not cached and could not be downloaded
bool download_active();                           // a language pack download is in flight
// The fraction 0..1 of the download of `tag` ("" = any download in flight), or -1 when there is none.
// Calls the refresh hook (main thread) whenever it changes, and when a download starts or ends.
double download_progress(const std::string& tag);

// CLI: cache only. `lang_flag` is the value of --locale, or nullptr.
void load_cli_language(const char* lang_flag);
// --forge-fetch-locale [tag]: synchronous download into the cache; returns the exit code.
int run_fetch_lang(const char* tag);

}  // namespace forge_app
