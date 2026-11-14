// Language loader and renderer for generated macOS apps (Foundation only).
#import <Foundation/Foundation.h>

#include <dispatch/dispatch.h>
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

namespace {

bool is_loopback(NSString* host) {
  return [host isEqualToString:@"127.0.0.1"] || [host isEqualToString:@"localhost"] || [host isEqualToString:@"::1"];
}

// https everywhere; plain http only to this machine (tests).
bool url_allowed(NSURL* url) {
  NSString* scheme = [[url scheme] lowercaseString];
  if ([scheme isEqualToString:@"https"]) return true;
  return [scheme isEqualToString:@"http"] && is_loopback([[url host] lowercaseString]);
}

}  // namespace

@interface ForgeRedirectGuard : NSObject <NSURLSessionTaskDelegate>
@end

@implementation ForgeRedirectGuard
- (void)URLSession:(NSURLSession*)session
                          task:(NSURLSessionTask*)task
    willPerformHTTPRedirection:(NSHTTPURLResponse*)response
                    newRequest:(NSURLRequest*)request
             completionHandler:(void (^)(NSURLRequest*))completionHandler {
  completionHandler(url_allowed([request URL]) ? request : nil);
}
@end

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

bool has(const std::vector<std::string>& list, const std::string& tag) { return std::find(list.begin(), list.end(), tag) != list.end(); }
void add(std::vector<std::string>& list, const std::string& tag) {
  if (!has(list, tag)) list.push_back(tag);
}
void drop(std::vector<std::string>& list, const std::string& tag) { list.erase(std::remove(list.begin(), list.end(), tag), list.end()); }

std::string env_string(const char* name) {
  const char* value = std::getenv(name);
  return value ? value : "";
}

void notify() {
  if (g_hook) g_hook();
}

NSUserDefaults* defaults() {
  static NSUserDefaults* suite = nil;
  if (!suite) {
    suite = [[NSUserDefaults alloc] initWithSuiteName:[NSString stringWithUTF8String:APP_ID]];
    if (!suite) suite = [NSUserDefaults standardUserDefaults];
  }
  return suite;
}

void store_language(const std::string& value) {
  if (value.empty()) {
    [defaults() removeObjectForKey:@"ForgeLanguage"];
  } else {
    [defaults() setObject:[NSString stringWithUTF8String:value.c_str()] forKey:@"ForgeLanguage"];
  }
  [defaults() synchronize];
}

bool download_allowed() {
  if (!DOWNLOAD_ENABLED) return false;
  return [defaults() objectForKey:@"ForgeLanguageDownload"] == nil || [defaults() boolForKey:@"ForgeLanguageDownload"];
}

std::vector<std::string> system_languages() {
  std::vector<std::string> out;
  for (NSString* language in [NSLocale preferredLanguages]) out.emplace_back([language UTF8String]);
  return out;
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
    preferred = system_languages();
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
  if (!override_dir.empty()) return override_dir;
  return std::string([NSHomeDirectory() UTF8String]) + "/Library/Application Support/" + APP_ID + "/lang";
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

bool store_in_cache(const PackDef& pack, const std::string& bytes) {
  NSString* dir = [NSString stringWithUTF8String:cache_dir().c_str()];
  NSFileManager* files = [NSFileManager defaultManager];
  if (![files createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil]) return false;
  const std::string final_path = cache_dir() + "/" + cache_name(pack);
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
  for (NSString* entry in [files contentsOfDirectoryAtPath:dir error:nil]) {
    std::string name = [entry UTF8String];
    if (name != current && name.size() == current.size() && name.compare(0, prefix.size(), prefix) == 0 &&
        name.compare(name.size() - 5, 5, ".lang") == 0)
      std::remove((cache_dir() + "/" + name).c_str());
  }
  return true;
}

// One blocking GET. Accepts only 200 with exactly the expected size and the pinned sha256.
bool download_pack(const PackDef& pack, std::string& error) {
  std::string base = env_string("FORGE_I18N_BASE_URL");
  if (base.empty()) base = PACK_BASE_URL;
  NSURL* url = [NSURL URLWithString:[NSString stringWithUTF8String:(base + pack.file).c_str()]];
  if (!url || !url_allowed(url)) {
    error = "refusing to download from " + base + " (https is required, except for loopback addresses)";
    return false;
  }
  double request_seconds = 10, resource_seconds = 30;
  const std::string timeout_ms = env_string("FORGE_I18N_TIMEOUT_MS");
  if (!timeout_ms.empty()) request_seconds = resource_seconds = std::atof(timeout_ms.c_str()) / 1000.0;
  NSURLSessionConfiguration* config = [NSURLSessionConfiguration ephemeralSessionConfiguration];
  config.timeoutIntervalForRequest = request_seconds;
  config.timeoutIntervalForResource = resource_seconds;
  NSURLSession* session = [NSURLSession sessionWithConfiguration:config delegate:[[ForgeRedirectGuard alloc] init] delegateQueue:nil];
  __block NSData* body = nil;
  __block NSURLResponse* response = nil;
  __block NSError* failure = nil;
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  NSURLSessionDataTask* task = [session dataTaskWithURL:url
                                      completionHandler:^(NSData* data, NSURLResponse* r, NSError* e) {
                                        body = data;
                                        response = r;
                                        failure = e;
                                        dispatch_semaphore_signal(done);
                                      }];
  [task resume];
  if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, (int64_t)((resource_seconds + 2) * NSEC_PER_SEC))) != 0) {
    [session invalidateAndCancel];
    error = "the download timed out";
    return false;
  }
  [session finishTasksAndInvalidate];
  if (failure) {
    error = [[failure localizedDescription] UTF8String];
    return false;
  }
  const long status = [response isKindOfClass:[NSHTTPURLResponse class]] ? (long)[(NSHTTPURLResponse*)response statusCode] : 0;
  if (status != 200) {
    error = "the server answered HTTP " + std::to_string(status);
    return false;
  }
  if ([body length] > forge_i18n::kMaxPackBytes || [body length] != pack.size) {
    error = "the downloaded pack has an unexpected size";
    return false;
  }
  const std::string bytes(static_cast<const char*>([body bytes]), [body length]);
  forge_i18n::Pack parsed;
  if (!verified(pack, bytes, parsed)) {
    error = "the downloaded pack does not match its checksum";
    return false;
  }
  if (!store_in_cache(pack, bytes)) {
    error = "could not write the language pack to the cache";
    return false;
  }
  return true;
}

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

// Downloads on a background queue; the result is applied on the main queue (only if it is still wanted).
void download_and_apply(const std::string& tag, bool store_choice) {
  if (has(g_inflight, tag)) return;
  add(g_inflight, tag);
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    std::string error;
    const PackDef* pack = find_pack(tag);
    const bool ok = pack && download_pack(*pack, error);
    dispatch_async(dispatch_get_main_queue(), ^{
      drop(g_inflight, tag);
      if (ok) {
        if (g_wanted == tag && apply_cached(tag) && store_choice) store_language(tag);
      } else {
        add(g_offline, tag);
      }
      notify();
    });
  });
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
  NSString* value = [defaults() stringForKey:@"ForgeLanguage"];
  return value ? [value UTF8String] : "";
}

std::string active_language() { return g_active; }

bool language_offline(const std::string& tag) { return has(g_offline, tag); }

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
      std::fprintf(stderr, "forge: downloading language packs is disabled for this app\n");
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
