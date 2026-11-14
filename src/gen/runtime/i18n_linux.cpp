// The Linux platform adapter of the language loader: GLib/GIO for settings, folders and threads. The logic is in i18n_common.cpp.
#include <gio/gio.h>
#include <glib.h>

#include <cstring>
#include <string>
#include <vector>

#include "i18n_loader.hpp"
#include "i18n_platform.hpp"

namespace forge_app::platform {
namespace {

// ~/.config/<APP_ID>/settings.ini, group [forge]: language= and download=.
std::string settings_dir() { return std::string(g_get_user_config_dir()) + "/" + APP_ID; }
std::string settings_path() { return settings_dir() + "/settings.ini"; }

}  // namespace

bool read_setting(const char* key, std::string& value) {
  GKeyFile* file = g_key_file_new();
  bool found = false;
  if (g_key_file_load_from_file(file, settings_path().c_str(), G_KEY_FILE_NONE, nullptr)) {
    if (char* text = g_key_file_get_string(file, "forge", key, nullptr)) {
      value = text;
      found = true;
      g_free(text);
    }
  }
  g_key_file_free(file);
  return found;
}

void write_setting(const char* key, const std::string& value) {
  GKeyFile* file = g_key_file_new();
  g_key_file_load_from_file(file, settings_path().c_str(), G_KEY_FILE_NONE, nullptr);
  if (value.empty()) g_key_file_remove_key(file, "forge", key, nullptr);
  else g_key_file_set_string(file, "forge", key, value.c_str());
  g_mkdir_with_parents(settings_dir().c_str(), 0755);
  g_key_file_save_to_file(file, settings_path().c_str(), nullptr);
  g_key_file_free(file);
}

std::vector<std::string> system_languages() {
  std::vector<std::string> out;
  for (const char* const* name = g_get_language_names(); *name; ++name)
    if (std::strcmp(*name, "C") != 0 && std::strcmp(*name, "POSIX") != 0) out.emplace_back(*name);
  return out;
}

std::string cache_base() { return std::string(g_get_user_cache_dir()) + "/" + APP_ID + "/lang"; }

namespace {

struct Task {
  void (*work)(void*);
  void (*done)(void*);
  void* context;
};

gboolean finish_on_main(gpointer data) {
  Task* task = static_cast<Task*>(data);
  task->done(task->context);
  delete task;
  return G_SOURCE_REMOVE;
}

gpointer thread_main(gpointer data) {
  Task* task = static_cast<Task*>(data);
  task->work(task->context);
  g_idle_add(finish_on_main, task);
  return nullptr;
}

}  // namespace

void post_to_main(void (*fn)(void*), void* context) {
  g_idle_add(
      [](gpointer data) -> gboolean {
        Task* task = static_cast<Task*>(data);
        task->work(task->context);
        delete task;
        return G_SOURCE_REMOVE;
      },
      new Task{fn, nullptr, context});
}

void run_in_background(void (*work)(void*), void (*done)(void*), void* context) {
  GThread* thread = g_thread_new("forge-i18n", thread_main, new Task{work, done, context});
  g_thread_unref(thread);  // detached: the result comes back through g_idle_add
}

}  // namespace forge_app::platform
