// Language loader and renderer shared by every platform: selection, cache, verification and download
// logic. The platform adapter (i18n_platform.hpp) supplies settings, the HTTP GET and threading.
#include <dirent.h>
#include <cctype>
#include <cerrno>
#include <cstddef>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <string_view>
#include <vector>

#include "i18n.hpp"
#include "i18n_loader.hpp"
#include "i18n_platform.hpp"

// FORGE_HTTP (defined by the generated forge_app.hpp) says the app carries the HTTP library: without it
// nothing here can download, and the HTTP code is not compiled.
#if __has_include("forge_app.hpp")
#include "forge_app.hpp"
#endif
#ifdef FORGE_HTTP
#include "http.hpp"
#endif

namespace forge_app {
namespace {

forge_i18n::Pack g_pack;
bool g_has_pack = false;
std::string g_active = "en";
std::string g_wanted = "en";
void (*g_hook)() = nullptr;
// Tiny lists (at most one entry per language pack): cheaper than std::set.
std::vector<std::string> g_offline;
std::vector<std::string> g_inflight;
// The progress of the downloads in flight, 0..1000 (per mille), parallel to g_inflight.
std::vector<int> g_permille;

bool has(const std::vector<std::string>& list, const std::string& tag) { return std::find(list.begin(), list.end(), tag) != list.end(); }
void add(std::vector<std::string>& list, const std::string& tag) {
  if (!has(list, tag)) list.push_back(tag);
}

std::string env_string(const char* name) {
  const char* value = std::getenv(name);
  return value ? value : "";
}

void notify() {
  if (g_hook) g_hook();
}

#ifdef FORGE_HTTP
std::string lower(std::string text) {
  for (char& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return text;
}

// https everywhere; plain http only to this machine (tests).
bool url_allowed(const std::string& url) {
  const std::size_t colon = url.find("://");
  if (colon == std::string::npos) return false;
  const std::string scheme = lower(url.substr(0, colon));
  if (scheme == "https") return true;
  if (scheme != "http") return false;
  const std::size_t start = colon + 3;
  std::string authority = url.substr(start, url.find_first_of("/?#", start) - start);
  const std::size_t at = authority.rfind('@');
  if (at != std::string::npos) authority.erase(0, at + 1);
  std::string host;
  if (!authority.empty() && authority[0] == '[') host = authority.substr(1, authority.find(']') - 1);
  else host = authority.substr(0, authority.find(':'));
  host = lower(host);
  return host == "127.0.0.1" || host == "localhost" || host == "::1";
}
#endif

void store_language(const std::string& value) { platform::write_setting("language", value); }

#ifdef FORGE_HTTP
using DownloadProgress = forge::remote::Progress;
#else
using DownloadProgress = void (*)(void* context, std::size_t received, std::size_t total);
#endif

bool download_allowed() {
#ifdef FORGE_HTTP
  if (!DOWNLOAD_ENABLED) return false;
  std::string value;
  return !platform::read_setting("download", value) || value != "false";
#else
  return false;
#endif
}

const PackDef* find_pack(const std::string& tag) {
  for (int i = 0; i < PACK_COUNT; ++i)
    if (tag == PACKS[i].tag) return &PACKS[i];
  return nullptr;
}

std::string pick(const std::vector<std::string>& preferred) {
  std::vector<std::string> available;
  for (int i = 0; i < PACK_COUNT; ++i) available.emplace_back(PACKS[i].tag);
  return forge_i18n::pick_locale(preferred, available);
}

// GUI: FORGE_LANG_PREFERENCE (tests) > the stored choice > the system languages.
std::string pick_gui_tag(bool use_stored) {
  std::vector<std::string> preferred;
  std::string forced = env_string("FORGE_LANG_PREFERENCE");
  if (!forced.empty()) {
    for (std::size_t start = 0; start <= forced.size();) {
      std::size_t end = forced.find(',', start);
      if (end == std::string::npos) end = forced.size();
      preferred.push_back(forced.substr(start, end - start));
      start = end + 1;
    }
  } else if (use_stored && !stored_language().empty()) {
    preferred.push_back(stored_language());
  } else {
    preferred = platform::system_languages();
  }
  return pick(preferred);
}

// CLI: --lang > FORGE_LANG > LC_ALL > LC_MESSAGES > LANG > the stored choice > the system languages.
std::string pick_cli_tag(const char* flag) {
  const std::string candidates[] = {flag ? flag : "", env_string("FORGE_LANG"), env_string("LC_ALL"),
                                    env_string("LC_MESSAGES"), env_string("LANG")};
  for (const std::string& candidate : candidates) {
    std::string tag = forge_i18n::normalize_tag(candidate);
    if (!tag.empty()) return pick({tag});
  }
  return pick_gui_tag(true);
}

std::string cache_dir() {
  std::string override_dir = env_string("FORGE_I18N_CACHE_DIR");
  return override_dir.empty() ? platform::cache_base() : override_dir;
}

std::string cache_name(const PackDef& pack) { return std::string(pack.tag) + "-" + std::string(pack.sha256).substr(0, 12) + ".lang"; }

bool read_file(const std::string& path, std::string& out) {
  FILE* file = std::fopen(path.c_str(), "rb");
  if (!file) return false;
  out.clear();
  char buffer[4096];
  std::size_t n;
  while ((n = std::fread(buffer, 1, sizeof buffer, file)) > 0 && out.size() <= forge_i18n::kMaxPackBytes) out.append(buffer, n);
  std::fclose(file);
  return true;
}

bool verified(const PackDef& pack, const std::string& bytes, forge_i18n::Pack& out) {
  std::string error;
  return bytes.size() <= forge_i18n::kMaxPackBytes && forge_i18n::sha256_hex(bytes) == pack.sha256 &&
         forge_i18n::parse_pack(bytes, out, error);
}

// The cached pack, checked against the hash that is pinned in the binary; a bad file is deleted.
bool load_cached(const PackDef& pack, forge_i18n::Pack& out) {
  const std::string path = cache_dir() + "/" + cache_name(pack);
  std::string bytes;
  if (!read_file(path, bytes)) return false;
  if (verified(pack, bytes, out)) return true;
  std::remove(path.c_str());
  return false;
}

#ifdef FORGE_HTTP
// mkdir -p
bool make_dirs(const std::string& path) {
  for (std::size_t i = 1; i <= path.size(); ++i) {
    if (i == path.size() || path[i] == '/') {
      const std::string part = path.substr(0, i);
      if (mkdir(part.c_str(), 0755) != 0 && errno != EEXIST) return false;
    }
  }
  return true;
}

bool store_in_cache(const PackDef& pack, const std::string& bytes) {
  const std::string dir = cache_dir();
  if (!make_dirs(dir)) return false;
  const std::string final_path = dir + "/" + cache_name(pack);
  const std::string temp_path = final_path + ".tmp" + std::to_string(getpid());
  FILE* file = std::fopen(temp_path.c_str(), "wb");
  if (!file) return false;
  const bool written = std::fwrite(bytes.data(), 1, bytes.size(), file) == bytes.size();
  if (std::fclose(file) != 0 || !written || std::rename(temp_path.c_str(), final_path.c_str()) != 0) {
    std::remove(temp_path.c_str());
    return false;
  }
  // Older packs of the same language are no longer pinned by this binary.
  const std::string current = cache_name(pack);
  const std::string prefix = std::string(pack.tag) + "-";
  if (DIR* listing = opendir(dir.c_str())) {
    while (const dirent* entry = readdir(listing)) {
      const std::string name = entry->d_name;
      if (name != current && name.size() == current.size() && name.compare(0, prefix.size(), prefix) == 0 &&
          name.compare(name.size() - 5, 5, ".lang") == 0)
        std::remove((dir + "/" + name).c_str());
    }
    closedir(listing);
  }
  return true;
}

// One blocking GET. Accepts only 200 with exactly the expected size and the pinned sha256.
bool download_pack(const PackDef& pack, std::string& error, DownloadProgress progress = nullptr, void* context = nullptr) {
  std::string base = env_string("FORGE_I18N_BASE_URL");
  if (base.empty()) base = PACK_BASE_URL;
  const std::string url = base + pack.file;
  if (!url_allowed(url)) {
    error = "refusing to download from " + base + " (https is required, except for loopback addresses)";
    return false;
  }
  int request_ms = 10000, resource_ms = 30000;
  const std::string timeout_ms = env_string("FORGE_I18N_TIMEOUT_MS");
  if (!timeout_ms.empty()) request_ms = resource_ms = std::atoi(timeout_ms.c_str());
  forge::remote::Args args;
  args.timeout_ms = request_ms;
  args.resource_timeout_ms = resource_ms;
  args.limit_response_size = forge_i18n::kMaxPackBytes;
  args.allowed = url_allowed;
  args.progress = progress;
  args.context = context;
  const forge::remote::Result response = forge::remote::get(url, args);
  if (!response.ok()) {
    const std::string& code = response.error.code;
    error = code == "too_large" ? "the downloaded pack has an unexpected size" : code == "timeout" ? "the download timed out" : response.error.message;
    return false;
  }
  if (response.response.code != 200) {
    error = "the server answered HTTP " + std::to_string(response.response.code);
    return false;
  }
  if (response.response.body.size() > forge_i18n::kMaxPackBytes || response.response.body.size() != pack.size) {
    error = "the downloaded pack has an unexpected size";
    return false;
  }
  forge_i18n::Pack parsed;
  if (!verified(pack, response.response.body, parsed)) {
    error = "the downloaded pack does not match its checksum";
    return false;
  }
  if (!store_in_cache(pack, response.response.body)) {
    error = "could not write the language pack to the cache";
    return false;
  }
  return true;
}
#else
bool download_pack(const PackDef&, std::string& error, DownloadProgress = nullptr, void* = nullptr) {
  error = "downloads are disabled in this build";
  return false;
}
#endif

bool apply_cached(const std::string& tag) {
  const PackDef* pack = find_pack(tag);
  forge_i18n::Pack loaded;
  if (!pack || !load_cached(*pack, loaded)) return false;
  g_pack = std::move(loaded);
  g_has_pack = true;
  g_active = pack->tag;
  return true;
}

void apply_english() {
  g_pack = forge_i18n::Pack();
  g_has_pack = false;
  g_active = "en";
}

void forget_download(const std::string& tag) {
  for (std::size_t i = 0; i < g_inflight.size(); ++i) {
    if (g_inflight[i] != tag) continue;
    g_inflight.erase(g_inflight.begin() + static_cast<std::ptrdiff_t>(i));
    g_permille.erase(g_permille.begin() + static_cast<std::ptrdiff_t>(i));
    return;
  }
}

struct Job {
  std::string tag;
  bool store_choice;
  bool ok;
  int posted;  // the last per mille handed to the main thread (worker thread only)
};

// What the worker hands to the main thread: a copy, so it needs nothing that dies with the job.
struct ProgressPost {
  std::string tag;
  int permille;
};

void progress_on_main(void* context) {
  ProgressPost* post = static_cast<ProgressPost*>(context);
  for (std::size_t i = 0; i < g_inflight.size(); ++i) {
    if (g_inflight[i] != post->tag || g_permille[i] == post->permille) continue;
    g_permille[i] = post->permille;
    notify();
  }
  delete post;
}

// Worker thread. Without a Content-Length the total is the size the binary pins for the pack.
void job_progress(void* context, std::size_t received, std::size_t total) {
  Job* job = static_cast<Job*>(context);
  if (total == 0) {
    const PackDef* pack = find_pack(job->tag);
    total = pack ? pack->size : 0;
  }
  if (total == 0) return;
  const int permille = static_cast<int>(std::min<std::size_t>(received, total) * 1000 / total);
  if (permille / 10 == job->posted / 10) return;  // at most one post per percent; 0% is shown from the start
  job->posted = permille;
  platform::post_to_main(progress_on_main, new ProgressPost{job->tag, permille});
}

void job_work(void* context) {
  Job* job = static_cast<Job*>(context);
  std::string error;
  const PackDef* pack = find_pack(job->tag);
  job->ok = pack && download_pack(*pack, error, job_progress, job);
}

// On the main thread: the result counts only if it is still wanted.
void job_done(void* context) {
  Job* job = static_cast<Job*>(context);
  forget_download(job->tag);
  if (job->ok) {
    if (g_wanted == job->tag && apply_cached(job->tag) && job->store_choice) store_language(job->tag);
  } else {
    add(g_offline, job->tag);
  }
  delete job;
  notify();
}

void download_and_apply(const std::string& tag, bool store_choice) {
  if (has(g_inflight, tag)) return;
  g_inflight.push_back(tag);
  g_permille.push_back(0);
  platform::run_in_background(job_work, job_done, new Job{tag, store_choice, false, 0});
  notify();  // a bar bound to the download shows up at 0%
}

const forge_i18n::Pack::Entry* find_entry(const std::string& context, std::string_view text) {
  auto it = std::lower_bound(g_pack.entries.begin(), g_pack.entries.end(), 0, [&](const forge_i18n::Pack::Entry& e, int) {
    return e.context != context ? e.context < context : std::string_view(e.text) < text;
  });
  return it != g_pack.entries.end() && it->context == context && it->text == text ? &*it : nullptr;
}

}  // namespace

std::string render(const Text& text) {
  if (text.message < 0) {
    if (text.translate && g_has_pack) return forge_i18n::lookup(g_pack, "", text.literal, 0, false);
    return text.literal ? text.literal : "";
  }
  const MessageDef& def = MESSAGES[text.message];
  const bool plural = def.plural != nullptr;
  // English: the singular only for a count of exactly 1.
  std::string pattern = plural && text.count != 1 ? def.plural : def.text;
  if (g_has_pack) {
    if (const forge_i18n::Pack::Entry* entry = find_entry(def.context ? def.context : "", def.text)) {
      std::size_t form = 0;
      if (plural && entry->forms.size() > 1) {
        const int index = forge_i18n::plural_index(g_pack.plural_formula, text.count);
        form = index < 0 ? entry->forms.size() : static_cast<std::size_t>(index);
      }
      if (form < entry->forms.size() && !entry->forms[form].empty()) pattern = entry->forms[form];
    }
  }
  return forge_i18n::format(pattern, text.args);
}


void set_refresh_hook(void (*hook)()) { g_hook = hook; }

std::string stored_language() {
  std::string value;
  return platform::read_setting("language", value) ? value : "";
}

std::string active_language() { return g_active; }

bool language_offline(const std::string& tag) { return has(g_offline, tag); }

bool download_active() { return !g_inflight.empty(); }

double download_progress(const std::string& tag) {
  for (std::size_t i = 0; i < g_inflight.size(); ++i)
    if (tag.empty() || g_inflight[i] == tag) return g_permille[i] / 1000.0;
  return -1;
}

void start_gui_language() {
  const std::string tag = pick_gui_tag(true);
  g_wanted = tag;
  if (tag == "en" || apply_cached(tag)) return;
  if (download_allowed()) download_and_apply(tag, false);
  else add(g_offline, tag);
}

void choose_language(const std::string& value) {
  std::string tag = value;
  if (value.empty()) {
    store_language("");
    tag = pick_gui_tag(false);
  } else if (value == "en") {
    store_language("en");
  }
  g_wanted = tag;
  if (tag == "en") {
    apply_english();
  } else if (apply_cached(tag)) {
    if (!value.empty()) store_language(value);
  } else if (download_allowed() && !has(g_offline, tag)) {
    download_and_apply(tag, !value.empty());
    return;  // the hook runs when the download finishes
  } else {
    add(g_offline, tag);
  }
  notify();
}

void load_cli_language(const char* lang_flag) {
  const std::string tag = pick_cli_tag(lang_flag);
  if (tag != "en") apply_cached(tag);
}

int run_fetch_lang(const char* requested) {
  std::string tag;
  if (requested && *requested) {
    const std::string normalized = forge_i18n::normalize_tag(requested);
    if (normalized == "en" || normalized.rfind("en-", 0) == 0) {
      tag = "en";
    } else {
      tag = normalized.empty() ? "en" : pick({normalized});
      if (tag == "en") {
        std::fprintf(stderr, "forge: no language pack for \"%s\"\n", requested);
        return 1;
      }
    }
  } else {
    tag = pick_cli_tag(nullptr);
  }
  if (tag == "en") {
    std::puts("English is built in; nothing to install");
    return 0;
  }
  const PackDef* pack = find_pack(tag);
  forge_i18n::Pack cached;
  if (pack && !load_cached(*pack, cached)) {
    if (!download_allowed()) {
#ifdef FORGE_HTTP
      std::fprintf(stderr, "forge: downloading language packs is disabled for this app\n");
#else
      std::fprintf(stderr, "forge: downloads are disabled in this build\n");
#endif
      return 1;
    }
    std::string error;
    if (!download_pack(*pack, error)) {
      std::fprintf(stderr, "forge: could not install the language pack %s: %s\n", tag.c_str(), error.c_str());
      return 1;
    }
  }
  std::printf("Language pack %s installed\n", tag.c_str());
  return 0;
}

}  // namespace forge_app
