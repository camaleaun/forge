// The Linux platform adapter of the language loader: GLib/GIO for settings, folders and threads, libsoup 3 for
// the download (TLS comes from glib-networking). The logic is in i18n_common.cpp.
#include <gio/gio.h>
#include <glib.h>
#include <libsoup/soup.h>

#include <cstring>
#include <string>
#include <vector>

#include "i18n_loader.hpp"
#include "i18n_platform.hpp"

namespace forge_app::platform {
namespace {

constexpr int kMaxRedirects = 5;

// ~/.config/<APP_ID>/settings.ini, group [forge]: language= and download=.
std::string settings_dir() { return std::string(g_get_user_config_dir()) + "/" + APP_ID; }
std::string settings_path() { return settings_dir() + "/settings.ini"; }

void free_error(GError* error) {
  if (error) g_error_free(error);
}

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

bool http_get(const std::string& url_text, std::size_t max_bytes, int request_ms, int resource_ms, UrlAllowed allowed, Http& out, Progress progress, void* context) {
  SoupSession* session = soup_session_new();
  soup_session_set_timeout(session, static_cast<guint>((request_ms + 999) / 1000));
  soup_session_set_idle_timeout(session, static_cast<guint>((request_ms + 999) / 1000));
  const gint64 deadline = g_get_monotonic_time() + static_cast<gint64>(resource_ms) * 1000;
  GCancellable* cancel = g_cancellable_new();
  std::string url = url_text;
  bool ok = false;
  for (int hop = 0; hop <= kMaxRedirects; ++hop) {
    GError* error = nullptr;
    SoupMessage* message = soup_message_new(SOUP_METHOD_GET, url.c_str());
    if (!message) {
      out.error = "the URL is not valid";
      break;
    }
    soup_message_add_flags(message, SOUP_MESSAGE_NO_REDIRECT);  // every hop is checked here
    GInputStream* stream = soup_session_send(session, message, cancel, &error);
    if (!stream) {
      out.error = error && g_error_matches(error, G_IO_ERROR, G_IO_ERROR_TIMED_OUT) ? "the download timed out" : (error ? error->message : "the download failed");
      free_error(error);
      g_object_unref(message);
      break;
    }
    const guint status = soup_message_get_status(message);
    const char* location = soup_message_headers_get_one(soup_message_get_response_headers(message), "Location");
    const bool redirect = (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) && location;
    if (redirect) {
      std::string next;
      GUri* target = g_uri_parse_relative(soup_message_get_uri(message), location, G_URI_FLAGS_NONE, nullptr);
      if (target) {
        char* text = g_uri_to_string(target);
        next = text;
        g_free(text);
        g_uri_unref(target);
      }
      g_object_unref(stream);
      g_object_unref(message);
      if (next.empty() || !allowed(next)) {  // refused: the 3xx is the answer
        out.status = status;
        ok = true;
        break;
      }
      if (hop == kMaxRedirects) {
        out.error = "too many redirects";
        break;
      }
      url = next;
      continue;
    }
    out.status = status;
    out.body.clear();
    SoupMessageHeaders* headers = soup_message_get_response_headers(message);
    const std::size_t total =
        soup_message_headers_get_encoding(headers) == SOUP_ENCODING_CONTENT_LENGTH ? static_cast<std::size_t>(soup_message_headers_get_content_length(headers)) : 0;
    if (progress) progress(context, 0, total);
    char buffer[4096];
    bool complete = true;
    while (true) {
      const gssize n = g_input_stream_read(stream, buffer, sizeof buffer, cancel, &error);
      if (n < 0) {
        out.error = g_error_matches(error, G_IO_ERROR, G_IO_ERROR_TIMED_OUT) ? "the download timed out" : error->message;
        free_error(error);
        complete = false;
        break;
      }
      if (n == 0) break;
      out.body.append(buffer, static_cast<std::size_t>(n));
      if (progress) progress(context, out.body.size(), total);
      if (out.body.size() > max_bytes) {
        out.error = "the downloaded pack has an unexpected size";
        complete = false;
        break;
      }
      if (g_get_monotonic_time() > deadline) {
        out.error = "the download timed out";
        complete = false;
        break;
      }
    }
    g_object_unref(stream);
    g_object_unref(message);
    ok = complete;
    break;
  }
  g_object_unref(cancel);
  g_object_unref(session);
  return ok;
}

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
