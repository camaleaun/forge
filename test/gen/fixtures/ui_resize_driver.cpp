// Runs the generated GTK UI for real (under a virtual display) and resizes its window: prints the content size
// and the bounds of every child of the root (x,y,w,h, relative to the root) before and after each size given as a
// "WIDTHxHEIGHT" argument, then exits. The window opens at its own size, so the first line is the base layout.
// With FORGE_RESIZE_WITH=xdotool the window is resized from outside, like a user does; otherwise with GTK itself.
#include <gtk/gtk.h>

#include <cstdio>
#include <cstdlib>
#include <string>
#include <unistd.h>
#include <utility>
#include <vector>

#include "forge_app.hpp"

namespace {

std::vector<std::pair<int, int>> g_sizes;
std::size_t g_next = 0;

GtkWindow* the_window() {
  GListModel* windows = gtk_window_get_toplevels();
  return g_list_model_get_n_items(windows) == 0 ? nullptr : GTK_WINDOW(g_list_model_get_item(windows, 0));
}

// The window's child is a plain frame (no padding) around the root: its size is the size of the content.
GtkWidget* frame() { return the_window() ? gtk_window_get_child(the_window()) : nullptr; }

void report() {
  GtkWidget* root = gtk_widget_get_first_child(frame());
  std::printf("%dx%d", gtk_widget_get_width(frame()), gtk_widget_get_height(frame()));
  for (GtkWidget* child = gtk_widget_get_first_child(root); child; child = gtk_widget_get_next_sibling(child)) {
    graphene_rect_t bounds;
    if (!gtk_widget_compute_bounds(child, frame(), &bounds)) continue;
    std::printf(" %d,%d,%d,%d", static_cast<int>(bounds.origin.x + 0.5f), static_cast<int>(bounds.origin.y + 0.5f),
                static_cast<int>(bounds.size.width + 0.5f), static_cast<int>(bounds.size.height + 0.5f));
  }
  std::printf("\n");
  std::fflush(stdout);
}

gboolean step(gpointer) {
  if (!frame() || gtk_widget_get_width(frame()) <= 0) return G_SOURCE_CONTINUE;  // not shown yet: try again
  report();
  if (g_next >= g_sizes.size()) std::exit(0);
  const auto [width, height] = g_sizes[g_next++];
  const char* with = std::getenv("FORGE_RESIZE_WITH");
  if (with && std::string(with) == "xdotool") {
    const std::string command = "xdotool search --onlyvisible --pid " + std::to_string(getpid()) + " | tail -n 1 | xargs -I{} xdotool windowsize {} " +
                                std::to_string(width) + " " + std::to_string(height);
    if (std::system(command.c_str()) != 0) std::fprintf(stderr, "xdotool failed\n");
  } else {
    gtk_window_set_default_size(the_window(), width, height);
  }
  g_timeout_add(1200, step, nullptr);
  return G_SOURCE_REMOVE;
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    int width = 0, height = 0;
    if (std::sscanf(argv[i], "%dx%d", &width, &height) == 2) g_sizes.emplace_back(width, height);
  }
  g_timeout_add(500, step, nullptr);
  char* only_program[] = {argv[0], nullptr};
  return forge_app::run_ui(1, only_program);
}
