// Test driver: runs one i18n runtime function and prints the result for the node tests.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "i18n.hpp"

using namespace forge_i18n;

static std::string slurp(const char* path) {
  std::ifstream in(path, std::ios::binary);
  return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

static std::vector<std::string> split_commas(const std::string& s) {
  std::vector<std::string> out;
  if (s.empty()) return out;
  std::size_t start = 0;
  for (;;) {
    std::size_t comma = s.find(',', start);
    if (comma == std::string::npos) { out.push_back(s.substr(start)); return out; }
    out.push_back(s.substr(start, comma - start));
    start = comma + 1;
  }
}

static void print_bracketed(const std::string& s) { std::printf("[%s]\n", s.c_str()); }

int main(int argc, char** argv) {
  if (argc < 2) return 64;
  std::string cmd = argv[1];
  if (cmd == "normalize" && argc == 3) {
    print_bracketed(normalize_tag(argv[2]));
  } else if (cmd == "pick" && argc == 4) {
    print_bracketed(pick_locale(split_commas(argv[2]), split_commas(argv[3])));
  } else if (cmd == "plural" && argc == 4) {
    std::printf("%d\n", plural_index(argv[2], std::strtol(argv[3], nullptr, 10)));
  } else if (cmd == "sha256" && argc == 3) {
    std::printf("%s\n", sha256_hex(slurp(argv[2])).c_str());
  } else if ((cmd == "parse" || cmd == "lookup") && argc >= 3) {
    Pack pack;
    std::string error;
    if (!parse_pack(slurp(argv[2]), pack, error)) {
      std::printf("error: %s\n", error.c_str());
      return 0;
    }
    if (cmd == "parse") {
      std::printf("ok tag=%s app=%s version=%s formula=%s nplurals=%d entries=%zu\n", pack.tag.c_str(), pack.app.c_str(),
                  pack.version.c_str(), pack.plural_formula.c_str(), pack.nplurals, pack.entries.size());
    } else if (argc == 7) {
      print_bracketed(lookup(pack, argv[3], argv[4], std::strtol(argv[5], nullptr, 10), argv[6][0] == '1'));
    } else {
      return 64;
    }
  } else if (cmd == "format" && argc >= 3) {
    std::vector<std::string> args(argv + 3, argv + argc);
    print_bracketed(forge_i18n::format(argv[2], args));
  } else {
    return 64;
  }
  return 0;
}
