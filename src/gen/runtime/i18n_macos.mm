// The macOS platform adapter of the language loader (Foundation only); the logic is in i18n_common.cpp.
#import <Foundation/Foundation.h>

#include <dispatch/dispatch.h>

#include <string>
#include <vector>

#include "i18n_loader.hpp"
#include "i18n_platform.hpp"

namespace {
forge_app::platform::UrlAllowed g_allowed = nullptr;
}

@interface ForgeRedirectGuard : NSObject <NSURLSessionTaskDelegate>
@end

@implementation ForgeRedirectGuard
- (void)URLSession:(NSURLSession*)session
                          task:(NSURLSessionTask*)task
    willPerformHTTPRedirection:(NSHTTPURLResponse*)response
                    newRequest:(NSURLRequest*)request
             completionHandler:(void (^)(NSURLRequest*))completionHandler {
  completionHandler(g_allowed([[[request URL] absoluteString] UTF8String]) ? request : nil);
}
@end

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

bool http_get(const std::string& url_text, std::size_t max_bytes, int request_ms, int resource_ms, UrlAllowed allowed, Http& out) {
  g_allowed = allowed;
  NSURL* url = [NSURL URLWithString:[NSString stringWithUTF8String:url_text.c_str()]];
  if (!url) {
    out.error = "the URL is not valid";
    return false;
  }
  const double resource_seconds = resource_ms / 1000.0;
  NSURLSessionConfiguration* config = [NSURLSessionConfiguration ephemeralSessionConfiguration];
  config.timeoutIntervalForRequest = request_ms / 1000.0;
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
    out.error = "the download timed out";
    return false;
  }
  [session finishTasksAndInvalidate];
  if (failure) {
    out.error = [[failure localizedDescription] UTF8String];
    return false;
  }
  out.status = [response isKindOfClass:[NSHTTPURLResponse class]] ? (long)[(NSHTTPURLResponse*)response statusCode] : 0;
  if ([body length] > max_bytes) {
    out.error = "the downloaded pack has an unexpected size";
    return false;
  }
  out.body.assign(static_cast<const char*>([body bytes]), [body length]);
  return true;
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
