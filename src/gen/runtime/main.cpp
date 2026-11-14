#include <cstring>

#include "cli_surface.hpp"
#include "forge_app.hpp"

int main(int argc, char** argv) {
  // Finder may pass a single -psn_* argument when launching an app: that is a UI launch.
  const bool finder_launch = argc == 2 && std::strncmp(argv[1], "-psn_", 5) == 0;
  if (argc > 1 && !finder_launch) {
    forge_app::CliSurface surface;
    return forge_app::run_cli(argc, argv, surface);
  }
  return forge_app::run_ui(argc, argv);
}
