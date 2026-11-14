// Portable i18n runtime for generated apps: plain C++20, standard library only,
// no exceptions (errors are return values), no iostream/regex/locale.
#pragma once
#include <string>
#include <string_view>
#include <vector>

namespace forge_i18n {

constexpr std::size_t kMaxPackBytes = 1024 * 1024;

std::string normalize_tag(std::string_view raw);
std::string pick_locale(const std::vector<std::string>& preferred, const std::vector<std::string>& available);
int plural_index(std::string_view formula, long n);

struct Pack {
  struct Entry {
    std::string context;
    std::string text;
    std::vector<std::string> forms;
  };
  std::string tag, app, version, plural_formula;
  int nplurals = 0;
  std::vector<Entry> entries;  // sorted by (context, text) after parse_pack
};

bool parse_pack(std::string_view bytes, Pack& out, std::string& error);
std::string lookup(const Pack& pack, std::string_view context, std::string_view text, long count, bool plural);
std::string format(std::string_view pattern, const std::vector<std::string>& args);
std::string sha256_hex(std::string_view bytes);

}  // namespace forge_i18n
