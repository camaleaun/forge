// The Linux adapter of forge::remote: one exchange over libsoup 3 (TLS comes from glib-networking). The policy is
// in http_common.cpp.
#include <gio/gio.h>
#include <glib.h>
#include <libsoup/soup.h>

#include <string>
#include <vector>

#include "http_adapter.hpp"

namespace forge::remote::adapter {
namespace {

bool is_name(const std::string& name, const char* wanted) { return g_ascii_strcasecmp(name.c_str(), wanted) == 0; }

Error from_glib(GError* error, bool late) {
  Error out;
  if (late || (error && g_error_matches(error, G_IO_ERROR, G_IO_ERROR_TIMED_OUT))) out = {"timeout", "the request timed out"};
  else if (error && error->domain == G_TLS_ERROR) out = {"tls", error->message};
  else out = {"network", error ? error->message : "the request failed"};
  if (error) g_error_free(error);
  return out;
}

void collect(const char* name, const char* value, gpointer list) { static_cast<std::vector<Header>*>(list)->push_back({name, value}); }

}  // namespace

Error exchange(const Exchange& ex) {
  SoupSession* session = soup_session_new();
  const guint seconds = static_cast<guint>((ex.timeout_ms + 999) / 1000);
  soup_session_set_timeout(session, seconds);
  soup_session_set_idle_timeout(session, seconds);
  SoupMessage* message = soup_message_new(ex.method->c_str(), ex.url->c_str());
  if (!message) {
    g_object_unref(session);
    return {"network", "the URL is not valid"};
  }
  soup_message_add_flags(message, SOUP_MESSAGE_NO_REDIRECT);  // every hop is the policy's decision
  std::string content_type;
  SoupMessageHeaders* request_headers = soup_message_get_request_headers(message);
  for (const Header& header : *ex.headers) {
    if (is_name(header.name, "User-Agent")) soup_session_set_user_agent(session, header.value.c_str());
    else if (is_name(header.name, "Content-Type")) content_type = header.value;
    else soup_message_headers_append(request_headers, header.name.c_str(), header.value.c_str());
  }
  if (!ex.body->empty()) {
    GBytes* bytes = g_bytes_new(ex.body->data(), ex.body->size());
    soup_message_set_request_body_from_bytes(message, content_type.empty() ? nullptr : content_type.c_str(), bytes);
    g_bytes_unref(bytes);
  } else if (!content_type.empty()) {
    soup_message_headers_replace(request_headers, "Content-Type", content_type.c_str());
  }
  const gint64 deadline = g_get_monotonic_time() + static_cast<gint64>(ex.resource_ms) * 1000;
  GCancellable* cancel = g_cancellable_new();
  GError* error = nullptr;
  Error result;
  if (GInputStream* stream = soup_session_send(session, message, cancel, &error)) {
    std::vector<Header> headers;
    soup_message_headers_foreach(soup_message_get_response_headers(message), collect, &headers);
    const char* phrase = soup_message_get_reason_phrase(message);
    if (ex.on_head(ex.context, static_cast<int>(soup_message_get_status(message)), phrase ? phrase : "", headers)) {
      char buffer[8192];
      while (true) {
        const gssize n = g_input_stream_read(stream, buffer, sizeof buffer, cancel, &error);
        if (n < 0) {
          result = from_glib(error, false);
          break;
        }
        if (n == 0 || !ex.on_data(ex.context, buffer, static_cast<std::size_t>(n))) break;
        if (g_get_monotonic_time() > deadline) {
          result = {"timeout", "the request timed out"};
          break;
        }
      }
    }
    g_object_unref(stream);
  } else {
    result = from_glib(error, false);
  }
  g_object_unref(cancel);
  g_object_unref(message);
  g_object_unref(session);
  return result;
}

}  // namespace forge::remote::adapter
