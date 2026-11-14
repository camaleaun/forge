// Runs the generated macOS UI of a steps app for real: prints the content size of the window, then clicks the visible
// button whose title is each argument in turn and prints the size again ("WIDTHxHEIGHT resizable=0|1 visible-titles, a disabled button marked with !").
// After a quit effect the process ends by itself, so no further line is printed.
#import <Cocoa/Cocoa.h>

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "forge_app.hpp"

namespace {

std::vector<std::string> g_clicks;
std::size_t g_next = 0;

void collect(NSView* view, NSMutableArray<NSButton*>* out) {
  if ([view isKindOfClass:[NSButton class]] && ![view isHiddenOrHasHiddenAncestor]) [out addObject:(NSButton*)view];
  for (NSView* child in [view subviews]) collect(child, out);
}

NSArray<NSButton*>* visible_buttons() {
  NSWindow* window = [[NSApp windows] firstObject];
  [[window contentView] layoutSubtreeIfNeeded];
  NSMutableArray<NSButton*>* buttons = [NSMutableArray array];
  collect([window contentView], buttons);
  return buttons;
}

void report() {
  NSWindow* window = [[NSApp windows] firstObject];
  const NSSize size = [[window contentView] frame].size;
  std::printf("%dx%d resizable=%d", (int)size.width, (int)size.height, (int)(([window styleMask] & NSWindowStyleMaskResizable) != 0));
  for (NSButton* button in visible_buttons()) std::printf(" %s%s", [button isEnabled] ? "" : "!", [[button title] UTF8String]);
  std::printf("\n");
  std::fflush(stdout);
}

void step() {
  report();
  if (g_next >= g_clicks.size()) std::exit(0);
  const std::string title = g_clicks[g_next++];
  for (NSButton* button in visible_buttons()) {
    if (title == [[button title] UTF8String]) {
      [button performClick:nil];
      break;
    }
  }
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    step();
  });
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) g_clicks.push_back(argv[i]);
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 600 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    step();
  });
  // run_ui returns when the app terminates: [NSApp terminate:] ends the process, so a quit effect never gets here.
  return forge_app::run_ui(0, nullptr);
}
