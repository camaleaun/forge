// The macOS platform adapter of the language loader (Foundation only); the logic is in i18n_common.cpp.
#import <Foundation/Foundation.h>

#include <dispatch/dispatch.h>

#include <string>
#include <vector>

#include "i18n_loader.hpp"
#include "i18n_platform.hpp"

namespace forge_app::platform {
namespace {

// The app's own domain (its bundle identifier is APP_ID), so `defaults write <APP_ID> ...` reaches it.
NSUserDefaults* defaults() { return [NSUserDefaults standardUserDefaults]; }

NSString* default_key(const char* key) { return std::string(key) == "language" ? @"ForgeLanguage" : @"ForgeLanguageDownload"; }

}  // namespace

bool read_setting(const char* key, std::string& value) {
  NSString* name = default_key(key);
  if ([defaults() objectForKey:name] == nil) return false;
  if (std::string(key) == "language") {
    NSString* text = [defaults() stringForKey:name];
    if (!text) return false;
    value = [text UTF8String];
  } else {
    value = [defaults() boolForKey:name] ? "true" : "false";
  }
  return true;
}

void write_setting(const char* key, const std::string& value) {
  NSString* name = default_key(key);
  if (value.empty()) {
    [defaults() removeObjectForKey:name];
  } else {
    [defaults() setObject:[NSString stringWithUTF8String:value.c_str()] forKey:name];
  }
  [defaults() synchronize];
}

std::vector<std::string> system_languages() {
  std::vector<std::string> out;
  for (NSString* language in [NSLocale preferredLanguages]) out.emplace_back([language UTF8String]);
  return out;
}

std::string cache_base() { return std::string([NSHomeDirectory() UTF8String]) + "/Library/Application Support/" + APP_ID + "/lang"; }

void post_to_main(void (*fn)(void*), void* context) {
  dispatch_async(dispatch_get_main_queue(), ^{
    fn(context);
  });
}

// Downloads on a background queue; `done` runs on the main queue.
void run_in_background(void (*work)(void*), void (*done)(void*), void* context) {
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    work(context);
    dispatch_async(dispatch_get_main_queue(), ^{
      done(context);
    });
  });
}

}  // namespace forge_app::platform
