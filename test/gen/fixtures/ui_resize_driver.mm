// Runs the generated macOS UI for real and resizes its window: prints the frames of the root's children
// (x,y,w,h of each arranged subview: its alignment rectangle, y from the top) before and after each size given as
// "WIDTHxHEIGHT" arguments, then exits. The window opens at its own size, so the first line is the base layout.
#import <Cocoa/Cocoa.h>

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "forge_app.hpp"

namespace {

std::vector<NSSize> g_sizes;
std::size_t g_next = 0;

NSArray<NSView*>* children_of_root() {
  NSWindow* window = [[NSApp windows] firstObject];
  [[window contentView] layoutSubtreeIfNeeded];
  NSStackView* root = (NSStackView*)[[[window contentView] subviews] firstObject];
  return [root arrangedSubviews];
}

void report() {
  NSWindow* window = [[NSApp windows] firstObject];
  const NSSize content = [[window contentView] frame].size;
  std::printf("%dx%d", (int)content.width, (int)content.height);
  for (NSView* view in children_of_root()) {
    // The rectangle the layout constraints talk about (a label's frame is a little larger), measured from the top.
    const NSRect f = [view alignmentRectForFrame:[view frame]];
    const int top = (int)(content.height - (f.origin.y + f.size.height));
    std::printf(" %d,%d,%d,%d", (int)f.origin.x, top, (int)f.size.width, (int)f.size.height);
  }
  std::printf("\n");
  std::fflush(stdout);
}

void step() {
  report();
  if (g_next >= g_sizes.size()) std::exit(0);
  NSWindow* window = [[NSApp windows] firstObject];
  [window setContentSize:g_sizes[g_next++]];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 400 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    step();
  });
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    int w = 0, h = 0;
    if (std::sscanf(argv[i], "%dx%d", &w, &h) == 2) g_sizes.push_back(NSMakeSize(w, h));
  }
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 600 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    step();
  });
  return forge_app::run_ui(0, nullptr);
}
