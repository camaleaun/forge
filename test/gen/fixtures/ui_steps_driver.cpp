// Runs the generated GTK UI of a steps app for real (under a virtual display): prints the content size of the window,
// then clicks the visible button whose label is each argument in turn and prints the size again
// ("WIDTHxHEIGHT resizable=0|1 visible-labels, a disabled button marked with !"). After a quit effect the application ends by itself.
#include <gtk/gtk.h>

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "forge_app.hpp"

namespace {

std::vector<std::string> g_clicks;
std::size_t g_next = 0;

GtkWindow* the_window() {
  GListModel* windows = gtk_window_get_toplevels();
  return g_list_model_get_n_items(windows) == 0 ? nullptr : GTK_WINDOW(g_list_model_get_item(windows, 0));
}

void collect(GtkWidget* widget, std::vector<GtkWidget*>& out) {
  if (GTK_IS_BUTTON(widget) && gtk_widget_get_mapped(widget)) out.push_back(widget);
  for (GtkWidget* child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child)) collect(child, out);
}

// The label of a button; the toggle button inside a dropdown has none.
const char* label_of(GtkWidget* button) {
  const char* label = gtk_button_get_label(GTK_BUTTON(button));
  return label ? label : "";
}

std::vector<GtkWidget*> visible_buttons() {
  std::vector<GtkWidget*> buttons;
  collect(GTK_WIDGET(the_window()), buttons);
  return buttons;
}

// With FORGE_GEOMETRY=1 a second line gives the rectangle of every visible button and of every 1 px high widget
// (the dividers) as x,y,w,h relative to the window content.
void collect_rects(GtkWidget* widget, GtkWidget* content, std::string& out) {
  const bool button = GTK_IS_BUTTON(widget);
  if (gtk_widget_get_mapped(widget) && (button || gtk_widget_get_height(widget) == 1)) {
    graphene_rect_t b;
    if (gtk_widget_compute_bounds(widget, content, &b))
      out += " " + std::string(button ? label_of(widget) : "line") + "=" + std::to_string(static_cast<int>(b.origin.x + 0.5f)) + "," +
             std::to_string(static_cast<int>(b.origin.y + 0.5f)) + "," + std::to_string(static_cast<int>(b.size.width + 0.5f)) + "," + std::to_string(static_cast<int>(b.size.height + 0.5f));
  }
  for (GtkWidget* child = gtk_widget_get_first_child(widget); child; child = gtk_widget_get_next_sibling(child)) collect_rects(child, content, out);
}

void geometry() {
  if (!std::getenv("FORGE_GEOMETRY")) return;
  std::string out = "geometry";
  collect_rects(gtk_window_get_child(the_window()), gtk_window_get_child(the_window()), out);
  std::printf("%s\n", out.c_str());
  std::fflush(stdout);
}

void report() {
  GtkWidget* content = gtk_window_get_child(the_window());
  // The size of the whole content widget, padding included (gtk_widget_get_width leaves the CSS padding out).
  graphene_rect_t box;
  if (!gtk_widget_compute_bounds(content, content, &box)) box = GRAPHENE_RECT_INIT(0, 0, 0, 0);
  std::printf("%dx%d resizable=%d", static_cast<int>(box.size.width + 0.5f), static_cast<int>(box.size.height + 0.5f), gtk_window_get_resizable(the_window()) ? 1 : 0);
  for (GtkWidget* button : visible_buttons()) std::printf(" %s%s", gtk_widget_is_sensitive(button) ? "" : "!", label_of(button));
  std::printf("\n");
  std::fflush(stdout);
  geometry();
}

gboolean step(gpointer) {
  if (!the_window() || !gtk_window_get_child(the_window()) || gtk_widget_get_width(gtk_window_get_child(the_window())) <= 0) return G_SOURCE_CONTINUE;
  report();
  if (g_next >= g_clicks.size()) std::exit(0);
  const std::string label = g_clicks[g_next++];
  if (label == "key:Enter") gtk_widget_activate_default(GTK_WIDGET(the_window()));  // what Enter does in a window with a default widget
  if (label == "key:Escape") {
    // The window's key controller gets the Escape key press (the display server's own key delivery is GTK's job).
    GListModel* controllers = gtk_widget_observe_controllers(GTK_WIDGET(the_window()));
    for (guint i = 0; i < g_list_model_get_n_items(controllers); ++i) {
      GtkEventController* controller = GTK_EVENT_CONTROLLER(g_list_model_get_item(controllers, i));
      gboolean handled = FALSE;
      if (GTK_IS_EVENT_CONTROLLER_KEY(controller)) g_signal_emit_by_name(controller, "key-pressed", static_cast<guint>(GDK_KEY_Escape), 0u, 0, &handled);
      g_object_unref(controller);
      if (handled) break;
    }
    g_object_unref(controllers);
  }
  int w = 0, h = 0;
  if (std::sscanf(label.c_str(), "%dx%d", &w, &h) == 2) {
    gtk_window_set_default_size(the_window(), w, h);
    gtk_widget_set_size_request(gtk_window_get_child(the_window()), w, h);
  }
  for (GtkWidget* button : visible_buttons()) {
    if (label == label_of(button)) {
      gtk_widget_activate(button);
      break;
    }
  }
  g_timeout_add(1200, step, nullptr);
  return G_SOURCE_REMOVE;
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) g_clicks.push_back(argv[i]);
  g_timeout_add(500, step, nullptr);
  char* only_program[] = {argv[0], nullptr};
  return forge_app::run_ui(1, only_program);
}
