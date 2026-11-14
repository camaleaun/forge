#include <cstring>

#include "cli_surface.hpp"
#include "forge_app.hpp"

#ifdef FORGE_I18N
#include <vector>

// Apps with language packs: --locale <tag> is global (before or after the command) and never reaches the
// commands; --forge-fetch-locale [tag] installs a pack; the cached pack of the chosen language is loaded first.
static int run_cli_with_language(int argc, char** argv) {
  const char* lang = nullptr;
  std::vector<char*> args{argv[0]};
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--locale") == 0) {
      if (i + 1 >= argc) {
        std::fputs("--locale needs a language tag (for example --locale pt-BR)\n", stderr);
        return 2;
      }
      lang = argv[++i];
    } else if (std::strncmp(argv[i], "--locale=", 9) == 0) {
      lang = argv[i] + 9;
    } else {
      args.push_back(argv[i]);
    }
  }
  for (std::size_t i = 1; i < args.size(); ++i) {
    if (std::strcmp(args[i], "--forge-fetch-locale") == 0) {
      const bool has_tag = i + 1 < args.size() && args[i + 1][0] != '-';
      return forge_app::run_fetch_lang(has_tag ? args[i + 1] : lang);
    }
  }
  if (args.size() < 2) return forge_app::run_ui(argc, argv);
  forge_app::load_cli_language(lang);
  args.push_back(nullptr);
  forge_app::CliSurface surface;
  return forge_app::run_cli(static_cast<int>(args.size()) - 1, args.data(), surface);
}
#endif

int main(int argc, char** argv) {
  // Finder may pass a single -psn_* argument when launching an app: that is a UI launch.
  const bool finder_launch = argc == 2 && std::strncmp(argv[1], "-psn_", 5) == 0;
  if (argc > 1 && !finder_launch) {
#ifdef FORGE_I18N
    return run_cli_with_language(argc, argv);
#else
    forge_app::CliSurface surface;
    return forge_app::run_cli(argc, argv, surface);
#endif
  }
  return forge_app::run_ui(argc, argv);
}
