// The macOS adapter of forge::remote: one exchange over NSURLSession (Foundation only). The policy is in http_common.cpp.
#import <Foundation/Foundation.h>

#include <dispatch/dispatch.h>

#include <string>
#include <vector>

#include "http_adapter.hpp"

// One per exchange: a redirect is not followed (its 3xx is the answer), and the body goes straight to the policy.
@interface ForgeHttpTask : NSObject <NSURLSessionDataDelegate> {
 @public
  const forge::remote::adapter::Exchange* exchange;
  NSError* failure;
  BOOL stopped;
  dispatch_semaphore_t finished;
}
@end

@implementation ForgeHttpTask
- (void)URLSession:(NSURLSession*)session
                          task:(NSURLSessionTask*)task
    willPerformHTTPRedirection:(NSHTTPURLResponse*)response
                    newRequest:(NSURLRequest*)request
             completionHandler:(void (^)(NSURLRequest*))completionHandler {
  completionHandler(nil);
}

- (void)URLSession:(NSURLSession*)session
              dataTask:(NSURLSessionDataTask*)task
    didReceiveResponse:(NSURLResponse*)reply
     completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
  __block std::vector<forge::remote::Header> headers;
  int code = 0;
  if ([reply isKindOfClass:[NSHTTPURLResponse class]]) {
    NSHTTPURLResponse* http = (NSHTTPURLResponse*)reply;
    code = (int)[http statusCode];
    [[http allHeaderFields] enumerateKeysAndObjectsUsingBlock:^(id key, id value, BOOL*) {
      headers.push_back({[[key description] UTF8String], [[value description] UTF8String]});
    }];
  }
  if (exchange->on_head(exchange->context, code, "", headers)) {
    completionHandler(NSURLSessionResponseAllow);
  } else {
    stopped = YES;
    completionHandler(NSURLSessionResponseCancel);
  }
}

- (void)URLSession:(NSURLSession*)session dataTask:(NSURLSessionDataTask*)task didReceiveData:(NSData*)data {
  if (stopped) return;
  [data enumerateByteRangesUsingBlock:^(const void* bytes, NSRange range, BOOL* stop) {
    if (!stopped && !exchange->on_data(exchange->context, static_cast<const char*>(bytes), range.length)) {
      stopped = YES;
      *stop = YES;
    }
  }];
  if (stopped) [task cancel];
}

- (void)URLSession:(NSURLSession*)session task:(NSURLSessionTask*)task didCompleteWithError:(NSError*)error {
  failure = error;
  dispatch_semaphore_signal(finished);
}
@end

namespace forge::remote::adapter {

Error exchange(const Exchange& ex) {
  NSURL* url = [NSURL URLWithString:[NSString stringWithUTF8String:ex.url->c_str()]];
  if (!url) return {"network", "the URL is not valid"};
  const double resource_seconds = ex.resource_ms / 1000.0;
  NSURLSessionConfiguration* config = [NSURLSessionConfiguration ephemeralSessionConfiguration];
  config.timeoutIntervalForRequest = ex.timeout_ms / 1000.0;
  config.timeoutIntervalForResource = resource_seconds;
  config.HTTPCookieAcceptPolicy = NSHTTPCookieAcceptPolicyNever;
  config.HTTPShouldSetCookies = NO;
  config.URLCache = nil;
  config.URLCredentialStorage = nil;
  config.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
  NSMutableURLRequest* request = [NSMutableURLRequest requestWithURL:url];
  request.HTTPMethod = [NSString stringWithUTF8String:ex.method->c_str()];
  for (const Header& header : *ex.headers)
    [request addValue:[NSString stringWithUTF8String:header.value.c_str()] forHTTPHeaderField:[NSString stringWithUTF8String:header.name.c_str()]];
  if (!ex.body->empty()) request.HTTPBody = [NSData dataWithBytes:ex.body->data() length:ex.body->size()];
  ForgeHttpTask* task = [[ForgeHttpTask alloc] init];
  task->exchange = &ex;
  task->finished = dispatch_semaphore_create(0);
  NSURLSession* session = [NSURLSession sessionWithConfiguration:config delegate:task delegateQueue:nil];
  [[session dataTaskWithRequest:request] resume];
  if (dispatch_semaphore_wait(task->finished, dispatch_time(DISPATCH_TIME_NOW, (int64_t)((resource_seconds + 2) * NSEC_PER_SEC))) != 0) {
    [session invalidateAndCancel];
    return {"timeout", "the request timed out"};
  }
  [session finishTasksAndInvalidate];
  NSError* failure = task->failure;
  if (!failure || task->stopped) return {};
  const NSInteger code = [failure code];
  if (code == NSURLErrorTimedOut) return {"timeout", "the request timed out"};
  if (code <= NSURLErrorSecureConnectionFailed && code >= NSURLErrorClientCertificateRequired) return {"tls", [[failure localizedDescription] UTF8String]};
  return {"network", [[failure localizedDescription] UTF8String]};
}

}  // namespace forge::remote::adapter
