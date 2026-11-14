// A fake platform adapter plus a scripted driver: it links against the portable loader (i18n_common.cpp)
// and proves its logic on any machine. Commands come from stdin, one per line; results go to stdout.
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <dirent.h>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include "i18n_loader.hpp"
#include "http_adapter.hpp"
#include "i18n_platform.hpp"

namespace {

std::map<std::string, std::string> g_settings;
std::vector<std::string> g_system_languages;
std::string g_cache_base = "/nonexistent-forge-cache";
std::string g_http_mode = "ok";  // ok | nolength | failhalf | status404 | fail | redirect-http | big
std::string g_pack_path;
std::vector<std::string> g_urls;
std::vector<std::string> g_hops;
struct Job {
  void (*work)(void*);
  void (*done)(void*);
  void* context;
};
std::vector<Job> g_jobs;
std::vector<Job> g_worked;  // jobs whose work ran but whose `done` has not
std::vector<Job> g_posts;   // what the worker posted to the main thread (done is unused)

std::string slurp(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  std::ostringstream out;
  out << in.rdbuf();
  return out.str();
}

}  // namespace

namespace forge_app::platform {

bool read_setting(const char* key, std::string& value) {
  auto it = g_settings.find(key);
  if (it == g_settings.end()) return false;
  value = it->second;
  return true;
}
void write_setting(const char* key, const std::string& value) {
  if (value.empty()) g_settings.erase(key);
  else g_settings[key] = value;
}
std::vector<std::string> system_languages() { return g_system_languages; }
std::string cache_base() { return g_cache_base; }

void post_to_main(void (*fn)(void*), void* context) { g_posts.push_back({fn, nullptr, context}); }

// The "main thread" is the driver: jobs run when it says `pump`.
void run_in_background(void (*work)(void*), void (*done)(void*), void* context) { g_jobs.push_back({work, done, context}); }

}  // namespace forge_app::platform

// The fake sits under the real HTTP policy (http_common.cpp): it only plays the server, one exchange at a time.
namespace forge::remote::adapter {

Error exchange(const Exchange& ex) {
  g_urls.push_back(*ex.url);
  if (g_http_mode == "fail") return {"network", "connection refused"};
  if (g_http_mode == "timeout") return {"timeout", "timed out"};
  if (g_http_mode == "redirect-http") {
    const std::string hop = "http://evil.example/pack.lang";
    g_hops.push_back(hop);
    ex.on_head(ex.context, 302, "", {{"Location", hop}});  // the policy refuses the hop: the 3xx is the answer
    return {};
  }
  if (g_http_mode == "status404") {
    ex.on_head(ex.context, 404, "", {});
    return {};
  }
  const std::string body = slurp(g_pack_path);
  std::vector<Header> headers;
  if (g_http_mode != "nolength") headers.push_back({"Content-Length", std::to_string(body.size())});
  if (!ex.on_head(ex.context, 200, "", headers)) return {};
  // The body arrives in two halves: 50% and 100%.
  if (!ex.on_data(ex.context, body.data(), body.size() / 2)) return {};
  if (g_http_mode == "failhalf") return {"network", "connection reset"};
  ex.on_data(ex.context, body.data() + body.size() / 2, body.size() - body.size() / 2);
  return {};
}

}  // namespace forge::remote::adapter

namespace {

std::vector<std::string> list_cache() {
  std::vector<std::string> names;
  if (DIR* dir = opendir(g_cache_base.c_str())) {
    while (dirent* entry = readdir(dir))
      if (entry->d_name[0] != '.') names.push_back(entry->d_name);
    closedir(dir);
  }
  std::sort(names.begin(), names.end());
  return names;
}

std::string join(const std::vector<std::string>& parts) {
  std::string out;
  for (const std::string& part : parts) out += (out.empty() ? "" : ",") + part;
  return out;
}

void refreshed() { std::puts("hook"); }

}  // namespace

int main() {
  using namespace forge_app;
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream words(line);
    std::string command;
    words >> command;
    std::string rest;
    std::getline(words, rest);
    if (!rest.empty() && rest[0] == ' ') rest.erase(0, 1);
    if (command == "set") {
      const std::size_t space = rest.find(' ');
      g_settings[rest.substr(0, space)] = rest.substr(space + 1);
    } else if (command == "get") {
      std::string value;
      std::puts(platform::read_setting(rest.c_str(), value) ? value.c_str() : "<none>");
    } else if (command == "syslang") {
      g_system_languages.clear();
      for (std::size_t start = 0; start <= rest.size();) {
        std::size_t end = rest.find(',', start);
        if (end == std::string::npos) end = rest.size();
        g_system_languages.push_back(rest.substr(start, end - start));
        start = end + 1;
      }
    } else if (command == "cachebase") {
      g_cache_base = rest;
    } else if (command == "http") {
      g_http_mode = rest;
    } else if (command == "packfile") {
      g_pack_path = rest;
    } else if (command == "plant") {  // plant <name> <file>: copies a file into the cache directory
      const std::size_t space = rest.find(' ');
      std::ofstream(g_cache_base + "/" + rest.substr(0, space), std::ios::binary) << slurp(rest.substr(space + 1));
    } else if (command == "plantjunk") {  // plantjunk <name>: writes a file with bytes that match no pack
      std::ofstream(g_cache_base + "/" + rest, std::ios::binary) << "junk";
    } else if (command == "hook") {
      set_refresh_hook(refreshed);
    } else if (command == "start") {
      start_gui_language();
    } else if (command == "choose") {
      choose_language(rest);
    } else if (command == "cli") {
      load_cli_language(rest == "-" ? nullptr : rest.c_str());
    } else if (command == "fetch") {
      std::printf("exit %d\n", run_fetch_lang(rest.empty() ? nullptr : rest.c_str()));
    } else if (command == "pump") {
      while (!g_jobs.empty()) {
        Job job = g_jobs.front();
        g_jobs.erase(g_jobs.begin());
        job.work(job.context);
        while (!g_posts.empty()) {
          Job post = g_posts.front();
          g_posts.erase(g_posts.begin());
          post.work(post.context);
        }
        job.done(job.context);
      }
    } else if (command == "work") {  // the worker thread runs: its progress posts wait for `post`
      g_worked.push_back(g_jobs.front());
      g_jobs.erase(g_jobs.begin());
      g_worked.back().work(g_worked.back().context);
    } else if (command == "post") {  // the main thread handles the oldest post
      Job post = g_posts.front();
      g_posts.erase(g_posts.begin());
      post.work(post.context);
    } else if (command == "done") {  // the worker finished: `done` runs on the main thread
      Job job = g_worked.front();
      g_worked.erase(g_worked.begin());
      job.done(job.context);
    } else if (command == "posts") {
      std::printf("%zu\n", g_posts.size());
    } else if (command == "active-download") {
      std::puts(download_active() ? "yes" : "no");
    } else if (command == "progress") {  // progress <tag>: percent rounded, or -1
      const double fraction = download_progress(rest);
      std::printf("%d\n", fraction < 0 ? -1 : static_cast<int>(fraction * 100 + 0.5));
    } else if (command == "active") {
      std::puts(active_language().c_str());
    } else if (command == "stored") {
      const std::string value = stored_language();
      std::puts(value.empty() ? "<auto>" : value.c_str());
    } else if (command == "offline") {
      std::puts(language_offline(rest) ? "yes" : "no");
    } else if (command == "render") {
      std::puts(render(Text::tr(rest.c_str())).c_str());
    } else if (command == "cache") {
      std::puts(join(list_cache()).c_str());
    } else if (command == "urls") {
      std::puts(join(g_urls).c_str());
    } else if (command == "hops") {
      std::puts(join(g_hops).c_str());
    } else if (command == "jobs") {
      std::printf("%zu\n", g_jobs.size());
    }
    std::fflush(stdout);
  }
  return 0;
}
