// A UI stub that downloads the language pack chosen by FORGE_LANG_PREFERENCE and prints what a progress bar
// bound to the download would show: one line per refresh ("progress <percent>"), then "end <active language>".
// It runs the platform's main loop, because the progress arrives on the main thread.
#include <cstdio>
#include <cstdlib>

#include "forge_app.hpp"
#include "i18n_loader.hpp"

#ifdef __APPLE__
#include <dispatch/dispatch.h>
#else
#include <glib.h>
#endif

namespace {

void refreshed() {
  if (forge_app::download_active()) {
    std::printf("progress %d\n", static_cast<int>(forge_app::download_progress("") * 100 + 0.5));
    std::fflush(stdout);
    return;
  }
  std::printf("end %s\n", forge_app::active_language().c_str());
  std::fflush(stdout);
  std::exit(0);
}

}  // namespace

int forge_app::run_ui(int, char**) {
  set_refresh_hook(refreshed);
  start_gui_language();
#ifdef __APPLE__
  dispatch_main();
#else
  g_main_loop_run(g_main_loop_new(nullptr, FALSE));
#endif
  return 0;
}
