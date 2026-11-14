#include "i18n.hpp"

#include <algorithm>
#include <cstdint>
#include <cstring>

namespace forge_i18n {

namespace {

bool is_alpha(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
bool is_digit(char c) { return c >= '0' && c <= '9'; }
char lower(char c) { return (c >= 'A' && c <= 'Z') ? static_cast<char>(c - 'A' + 'a') : c; }
char upper(char c) { return (c >= 'a' && c <= 'z') ? static_cast<char>(c - 'a' + 'A') : c; }

std::string lower_all(std::string_view s) {
  std::string out;
  for (char c : s) out += lower(c);
  return out;
}

std::string_view language_of(std::string_view tag) { return tag.substr(0, tag.find('-')); }

}  // namespace

// "pt_BR.UTF-8" -> "pt-BR": drop @modifier and .encoding, '_' -> '-', fix the case of each subtag.
std::string normalize_tag(std::string_view raw) {
  raw = raw.substr(0, raw.find_first_of(".@"));
  std::string out;
  std::size_t start = 0;
  bool first = true;
  while (start <= raw.size()) {
    std::size_t end = raw.find_first_of("_-", start);
    if (end == std::string_view::npos) end = raw.size();
    std::string_view part = raw.substr(start, end - start);
    if (part.empty()) return "";
    bool alpha = true, alnum = true, digits = true;
    for (char c : part) {
      if (!is_alpha(c)) alpha = false;
      if (!is_alpha(c) && !is_digit(c)) alnum = false;
      if (!is_digit(c)) digits = false;
    }
    if (!alnum) return "";
    if (!first) out += '-';
    if (first) {
      if (!alpha) return "";
      out += lower_all(part);
    } else if (alpha && part.size() == 4) {  // script: Hant
      out += upper(part[0]);
      out += lower_all(part.substr(1));
    } else if ((alpha && part.size() == 2) || (digits && part.size() == 3)) {  // region: BR, 419
      for (char c : part) out += upper(c);
    } else {
      out += lower_all(part);
    }
    first = false;
    start = end + 1;
  }
  if (out == "c" || out == "posix") return "";
  return out;
}

// For each preferred tag in order: exact pack, then the bare language, then any pack of the same
// language. English (or no pack found before reaching it) means the built-in text: "en".
std::string pick_locale(const std::vector<std::string>& preferred, const std::vector<std::string>& available) {
  for (const std::string& raw : preferred) {
    std::string tag = normalize_tag(raw);
    if (tag.empty()) continue;
    std::string_view language = language_of(tag);
    if (language == "en") return "en";
    for (const std::string& pack : available)
      if (lower_all(pack) == lower_all(tag)) return pack;
    for (const std::string& pack : available)
      if (lower_all(pack) == language) return pack;
    for (const std::string& pack : available)
      if (lower_all(language_of(pack)) == language) return pack;
  }
  return "en";
}
namespace {

// Closed gettext grammar: n, decimal numbers, % == != < > <= >= && || ! ?: and parentheses.
// The formula is parsed into a bounded node array and then evaluated: no dynamic code, no calls.
constexpr std::size_t kMaxFormulaChars = 256;
constexpr int kMaxFormulaDepth = 32;
constexpr int kMaxFormulaNodes = 256;

enum class Op { Num, N, Mod, Eq, Ne, Lt, Gt, Le, Ge, And, Or, Not, Cond };

struct FormulaNode {
  Op op;
  long value;  // Num
  int a, b, c;  // child indexes
};

class FormulaParser {
 public:
  explicit FormulaParser(std::string_view text) : text_(text) {}

  // Returns the root index or -1 when the formula is invalid.
  int parse() {
    int root = ternary(0);
    skip_space();
    if (failed_ || pos_ != text_.size()) return -1;
    return root;
  }
  const FormulaNode* nodes() const { return nodes_; }

 private:
  std::string_view text_;
  std::size_t pos_ = 0;
  bool failed_ = false;
  int count_ = 0;
  FormulaNode nodes_[kMaxFormulaNodes];

  int fail() { failed_ = true; return 0; }
  int make(Op op, long value = 0, int a = 0, int b = 0, int c = 0) {
    if (count_ >= kMaxFormulaNodes) return fail();
    nodes_[count_] = FormulaNode{op, value, a, b, c};
    return count_++;
  }
  void skip_space() {
    while (pos_ < text_.size() && (text_[pos_] == ' ' || text_[pos_] == '\t')) ++pos_;
  }
  bool eat(std::string_view token) {
    skip_space();
    if (text_.substr(pos_, token.size()) != token) return false;
    pos_ += token.size();
    return true;
  }
  // True when the next input is exactly `token` and not the longer operator that starts with it.
  bool peek_op(std::string_view token, char not_followed_by = '\0') {
    skip_space();
    if (text_.substr(pos_, token.size()) != token) return false;
    std::size_t after = pos_ + token.size();
    return !(not_followed_by && after < text_.size() && text_[after] == not_followed_by);
  }

  int ternary(int depth) {
    if (depth > kMaxFormulaDepth) return fail();
    int cond = logical_or(depth);
    if (failed_ || !peek_op("?")) return cond;
    eat("?");
    int yes = ternary(depth + 1);
    if (failed_ || !eat(":")) return fail();
    int no = ternary(depth + 1);
    return failed_ ? 0 : make(Op::Cond, 0, cond, yes, no);
  }
  int logical_or(int depth) {
    int left = logical_and(depth);
    while (!failed_ && peek_op("||")) {
      eat("||");
      int right = logical_and(depth);
      left = failed_ ? 0 : make(Op::Or, 0, left, right);
    }
    return left;
  }
  int logical_and(int depth) {
    int left = equality(depth);
    while (!failed_ && peek_op("&&")) {
      eat("&&");
      int right = equality(depth);
      left = failed_ ? 0 : make(Op::And, 0, left, right);
    }
    return left;
  }
  int equality(int depth) {
    int left = relational(depth);
    for (;;) {
      if (failed_) return 0;
      Op op;
      if (eat("==")) op = Op::Eq;
      else if (eat("!=")) op = Op::Ne;
      else return left;
      int right = relational(depth);
      left = failed_ ? 0 : make(op, 0, left, right);
    }
  }
  int relational(int depth) {
    int left = modulo(depth);
    for (;;) {
      if (failed_) return 0;
      Op op;
      if (eat("<=")) op = Op::Le;
      else if (eat(">=")) op = Op::Ge;
      else if (eat("<")) op = Op::Lt;
      else if (eat(">")) op = Op::Gt;
      else return left;
      int right = modulo(depth);
      left = failed_ ? 0 : make(op, 0, left, right);
    }
  }
  int modulo(int depth) {
    int left = unary(depth);
    while (!failed_ && eat("%")) {
      int right = unary(depth);
      left = failed_ ? 0 : make(Op::Mod, 0, left, right);
    }
    return left;
  }
  int unary(int depth) {
    if (depth > kMaxFormulaDepth) return fail();
    if (peek_op("!", '=')) {
      eat("!");
      int operand = unary(depth + 1);
      return failed_ ? 0 : make(Op::Not, 0, operand);
    }
    return primary(depth);
  }
  int primary(int depth) {
    skip_space();
    if (pos_ >= text_.size()) return fail();
    char c = text_[pos_];
    if (c == '(') {
      ++pos_;
      int inner = ternary(depth + 1);
      if (failed_ || !eat(")")) return fail();
      return inner;
    }
    if (c == 'n') {
      ++pos_;
      return make(Op::N);
    }
    if (is_digit(c)) {
      long value = 0;
      int digits = 0;
      while (pos_ < text_.size() && is_digit(text_[pos_])) {
        if (++digits > 18) return fail();
        value = value * 10 + (text_[pos_++] - '0');
      }
      return make(Op::Num, value);
    }
    return fail();
  }
};

// Evaluates a node; sets `error` on a zero divisor. Branches that are not taken are not evaluated.
long evaluate(const FormulaNode* nodes, int i, long n, bool& error) {
  const FormulaNode& node = nodes[i];
  switch (node.op) {
    case Op::Num: return node.value;
    case Op::N: return n;
    case Op::Not: return evaluate(nodes, node.a, n, error) == 0;
    case Op::Cond:
      return evaluate(nodes, node.a, n, error) != 0 ? evaluate(nodes, node.b, n, error) : evaluate(nodes, node.c, n, error);
    case Op::And: return evaluate(nodes, node.a, n, error) != 0 && evaluate(nodes, node.b, n, error) != 0;
    case Op::Or: return evaluate(nodes, node.a, n, error) != 0 || evaluate(nodes, node.b, n, error) != 0;
    default: break;
  }
  long left = evaluate(nodes, node.a, n, error);
  long right = evaluate(nodes, node.b, n, error);
  switch (node.op) {
    case Op::Mod:
      if (right == 0) { error = true; return 0; }
      return right == -1 ? 0 : left % right;  // -1 avoids the LONG_MIN % -1 trap
    case Op::Eq: return left == right;
    case Op::Ne: return left != right;
    case Op::Lt: return left < right;
    case Op::Gt: return left > right;
    case Op::Le: return left <= right;
    default: return left >= right;  // Op::Ge
  }
}

}  // namespace

// Form index for n, or -1 when the formula is invalid, divides by zero or yields a negative index.
int plural_index(std::string_view formula, long n) {
  if (formula.size() > kMaxFormulaChars) return -1;
  FormulaParser parser(formula);
  int root = parser.parse();
  if (root < 0) return -1;
  bool error = false;
  long result = evaluate(parser.nodes(), root, n, error);
  if (error || result < 0 || result > 1000) return -1;
  return static_cast<int>(result);
}
namespace {

// Strict UTF-8 (RFC 3629): no overlong forms, no surrogates, nothing above U+10FFFF.
bool valid_utf8(std::string_view s) {
  std::size_t i = 0;
  while (i < s.size()) {
    auto b = [&](std::size_t k) { return static_cast<unsigned char>(s[k]); };
    unsigned char c = b(i);
    std::size_t len;
    unsigned lo = 0x80, hi = 0xbf;  // allowed range of the first continuation byte
    if (c < 0x80) { ++i; continue; }
    else if (c >= 0xc2 && c <= 0xdf) len = 2;
    else if (c >= 0xe0 && c <= 0xef) { len = 3; if (c == 0xe0) lo = 0xa0; if (c == 0xed) hi = 0x9f; }
    else if (c >= 0xf0 && c <= 0xf4) { len = 4; if (c == 0xf0) lo = 0x90; if (c == 0xf4) hi = 0x8f; }
    else return false;
    if (i + len > s.size() || b(i + 1) < lo || b(i + 1) > hi) return false;
    for (std::size_t k = 2; k < len; ++k)
      if ((b(i + k) & 0xc0) != 0x80) return false;
    i += len;
  }
  return true;
}

std::string at_line(std::size_t line, const std::string& message) { return "line " + std::to_string(line) + ": " + message; }

// Decodes \\ \t \n \r; returns false (and sets `problem`) on any other escape.
bool unescape(std::string_view in, std::string& out, std::string& problem) {
  out.clear();
  for (std::size_t i = 0; i < in.size(); ++i) {
    if (in[i] != '\\') { out += in[i]; continue; }
    if (++i == in.size()) { problem = "invalid escape at end of line"; return false; }
    switch (in[i]) {
      case '\\': out += '\\'; break;
      case 't': out += '\t'; break;
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      default: problem = std::string("invalid escape \\") + in[i]; return false;
    }
  }
  return true;
}

std::string_view trim(std::string_view s) {
  while (!s.empty() && (s.front() == ' ' || s.front() == '\t')) s.remove_prefix(1);
  while (!s.empty() && (s.back() == ' ' || s.back() == '\t')) s.remove_suffix(1);
  return s;
}

constexpr std::string_view kHeaderHint = "missing header \"forge-lang 1 <tag> <app> <version>\"";

bool parse_header(std::string_view line, Pack& out, std::string& problem) {
  std::vector<std::string_view> fields;
  for (std::size_t i = 0; i < line.size();) {
    std::size_t end = line.find(' ', i);
    if (end == std::string_view::npos) end = line.size();
    if (end > i) fields.push_back(line.substr(i, end - i));
    i = end + 1;
  }
  if (fields.size() != 5 || fields[0] != "forge-lang" || fields[1] != "1") { problem = std::string(kHeaderHint); return false; }
  if (normalize_tag(fields[2]).empty()) { problem = "invalid tag"; return false; }
  out.tag = fields[2];
  out.app = fields[3];
  out.version = fields[4];
  return true;
}

// "plural-forms: nplurals=N; plural=EXPR[;]"
bool parse_plural_forms(std::string_view line, Pack& out, std::string& problem) {
  constexpr std::string_view kPrefix = "plural-forms:";
  if (line.substr(0, kPrefix.size()) != kPrefix) { problem = "expected \"plural-forms: nplurals=N; plural=EXPR\""; return false; }
  std::string_view rest = trim(line.substr(kPrefix.size()));
  constexpr std::string_view kCount = "nplurals=";
  if (rest.substr(0, kCount.size()) != kCount) { problem = "invalid nplurals"; return false; }
  rest.remove_prefix(kCount.size());
  std::size_t semicolon = rest.find(';');
  std::string_view digits = semicolon == std::string_view::npos ? std::string_view() : trim(rest.substr(0, semicolon));
  if (digits.size() != 1 || digits[0] < '1' || digits[0] > '6') { problem = "invalid nplurals"; return false; }
  rest = trim(rest.substr(semicolon + 1));
  constexpr std::string_view kPlural = "plural=";
  if (rest.substr(0, kPlural.size()) != kPlural) { problem = "invalid plural formula"; return false; }
  std::string_view formula = trim(rest.substr(kPlural.size()));
  if (!formula.empty() && formula.back() == ';') formula = trim(formula.substr(0, formula.size() - 1));
  if (plural_index(formula, 0) < 0 && plural_index(formula, 1) < 0) { problem = "invalid plural formula"; return false; }
  out.nplurals = digits[0] - '0';
  out.plural_formula = std::string(formula);
  return true;
}

bool entry_less(const Pack::Entry& a, const Pack::Entry& b) {
  return a.context != b.context ? a.context < b.context : a.text < b.text;
}

}  // namespace

bool parse_pack(std::string_view bytes, Pack& out, std::string& error) {
  out = Pack();
  if (bytes.size() > kMaxPackBytes) { error = "pack larger than 1 MB"; return false; }
  enum { kHeader, kPlural, kEntries } stage = kHeader;
  std::string context, problem;
  std::size_t line_no = 0, pos = 0;
  while (pos <= bytes.size()) {
    std::size_t end = bytes.find('\n', pos);
    bool last = end == std::string_view::npos;
    if (last) end = bytes.size();
    std::string_view line = bytes.substr(pos, end - pos);
    pos = end + 1;
    ++line_no;
    if (last && line.empty()) break;  // nothing after the final newline
    if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
    if (line.find('\0') != std::string_view::npos) { error = at_line(line_no, "NUL byte"); return false; }
    if (!valid_utf8(line)) { error = at_line(line_no, "invalid UTF-8"); return false; }
    if (line.empty() || line[0] == '#') continue;

    if (stage == kHeader) {
      if (!parse_header(line, out, problem)) { error = at_line(line_no, problem); return false; }
      stage = kPlural;
    } else if (stage == kPlural) {
      if (!parse_plural_forms(line, out, problem)) { error = at_line(line_no, problem); return false; }
      stage = kEntries;
    } else if (line.find('\t') == std::string_view::npos && line.substr(0, 8) == "@context" && (line.size() == 8 || line[8] == ' ')) {
      context = std::string(trim(line.substr(8)));
    } else {
      std::vector<std::string_view> cells;
      for (std::size_t i = 0;;) {
        std::size_t tab = line.find('\t', i);
        if (tab == std::string_view::npos) { cells.push_back(line.substr(i)); break; }
        cells.push_back(line.substr(i, tab - i));
        i = tab + 1;
      }
      if (cells.size() < 2) { error = at_line(line_no, "missing TAB"); return false; }
      if (cells[0].empty()) { error = at_line(line_no, "empty key"); return false; }
      std::size_t forms = cells.size() - 1;
      if (forms != 1 && forms != static_cast<std::size_t>(out.nplurals)) {
        error = at_line(line_no, "expected 1 or " + std::to_string(out.nplurals) + " translations, found " + std::to_string(forms));
        return false;
      }
      Pack::Entry entry;
      entry.context = context;
      if (!unescape(cells[0], entry.text, problem)) { error = at_line(line_no, problem); return false; }
      for (std::size_t i = 1; i < cells.size(); ++i) {
        entry.forms.emplace_back();
        if (!unescape(cells[i], entry.forms.back(), problem)) { error = at_line(line_no, problem); return false; }
      }
      out.entries.push_back(std::move(entry));
    }
  }
  if (stage == kHeader) { error = at_line(1, std::string(kHeaderHint)); return false; }
  if (stage == kPlural) { error = at_line(line_no, "expected \"plural-forms: nplurals=N; plural=EXPR\""); return false; }
  std::stable_sort(out.entries.begin(), out.entries.end(), entry_less);
  return true;
}

// The translated form, or `text` when the entry (or its form) is missing or empty.
std::string lookup(const Pack& pack, std::string_view context, std::string_view text, long count, bool plural) {
  auto it = std::lower_bound(pack.entries.begin(), pack.entries.end(), 0, [&](const Pack::Entry& e, int) {
    return e.context != context ? std::string_view(e.context) < context : std::string_view(e.text) < text;
  });
  if (it == pack.entries.end() || it->context != context || it->text != text) return std::string(text);
  std::size_t form = 0;
  if (plural && it->forms.size() > 1) {
    int index = plural_index(pack.plural_formula, count);
    if (index < 0 || static_cast<std::size_t>(index) >= it->forms.size()) return std::string(text);
    form = static_cast<std::size_t>(index);
  }
  return it->forms[form].empty() ? std::string(text) : it->forms[form];
}
namespace {

// PHP-style intval of the leading integer of `s` ("12abc" -> 12, "abc" -> 0); clamps on overflow.
std::string as_integer(const std::string& s) {
  std::size_t i = 0;
  while (i < s.size() && (s[i] == ' ' || s[i] == '\t')) ++i;
  bool negative = false;
  if (i < s.size() && (s[i] == '-' || s[i] == '+')) negative = s[i++] == '-';
  unsigned long long limit = negative ? 9223372036854775808ull : 9223372036854775807ull;
  unsigned long long value = 0;
  for (; i < s.size() && is_digit(s[i]); ++i) {
    unsigned digit = static_cast<unsigned>(s[i] - '0');
    if (value > (limit - digit) / 10) { value = limit; break; }
    value = value * 10 + digit;
  }
  return (negative && value ? "-" : "") + std::to_string(value);
}

}  // namespace

// Supports %s %d %N$s %N$d %%. Anything else (flags, widths, %n, a lone %) and specifiers without a
// matching argument are copied as they are; arguments are never re-scanned.
std::string format(std::string_view pattern, const std::vector<std::string>& args) {
  std::string out;
  std::size_t next = 0;
  for (std::size_t i = 0; i < pattern.size(); ++i) {
    if (pattern[i] != '%') { out += pattern[i]; continue; }
    std::size_t j = i + 1;
    if (j < pattern.size() && pattern[j] == '%') { out += '%'; ++i; continue; }
    std::size_t position = 0;  // 1-based; 0 = take the next plain argument
    bool numbered = false, valid = true;
    std::size_t digits_end = j;
    while (digits_end < pattern.size() && is_digit(pattern[digits_end])) ++digits_end;
    if (digits_end > j && digits_end < pattern.size() && pattern[digits_end] == '$') {
      numbered = true;
      if (digits_end - j > 4) valid = false;
      else for (std::size_t k = j; k < digits_end; ++k) position = position * 10 + static_cast<std::size_t>(pattern[k] - '0');
      if (position == 0) valid = false;
      j = digits_end + 1;
    }
    char type = j < pattern.size() ? pattern[j] : '\0';
    if (!valid || (type != 's' && type != 'd')) { out += '%'; continue; }
    std::size_t index = numbered ? position - 1 : next;
    if (index >= args.size()) { out += '%'; continue; }
    if (!numbered) ++next;
    out += type == 's' ? args[index] : as_integer(args[index]);
    i = j;
  }
  return out;
}
namespace {

constexpr std::uint32_t kSha256K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

std::uint32_t rotr(std::uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

void sha256_block(std::uint32_t h[8], const unsigned char* p) {
  std::uint32_t w[64];
  for (int i = 0; i < 16; ++i)
    w[i] = (std::uint32_t(p[4 * i]) << 24) | (std::uint32_t(p[4 * i + 1]) << 16) | (std::uint32_t(p[4 * i + 2]) << 8) |
           std::uint32_t(p[4 * i + 3]);
  for (int i = 16; i < 64; ++i) {
    std::uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
    std::uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  std::uint32_t v[8];
  std::memcpy(v, h, sizeof v);
  for (int i = 0; i < 64; ++i) {
    std::uint32_t t1 = v[7] + (rotr(v[4], 6) ^ rotr(v[4], 11) ^ rotr(v[4], 25)) + ((v[4] & v[5]) ^ (~v[4] & v[6])) +
                       kSha256K[i] + w[i];
    std::uint32_t t2 = (rotr(v[0], 2) ^ rotr(v[0], 13) ^ rotr(v[0], 22)) + ((v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]));
    v[7] = v[6]; v[6] = v[5]; v[5] = v[4]; v[4] = v[3] + t1;
    v[3] = v[2]; v[2] = v[1]; v[1] = v[0]; v[0] = t1 + t2;
  }
  for (int i = 0; i < 8; ++i) h[i] += v[i];
}

}  // namespace

std::string sha256_hex(std::string_view bytes) {
  std::uint32_t h[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  const auto* data = reinterpret_cast<const unsigned char*>(bytes.data());
  std::size_t full = bytes.size() / 64;
  for (std::size_t i = 0; i < full; ++i) sha256_block(h, data + 64 * i);

  unsigned char tail[128] = {};
  std::size_t rest = bytes.size() - full * 64;
  if (rest) std::memcpy(tail, data + full * 64, rest);
  tail[rest] = 0x80;
  std::size_t tail_len = rest < 56 ? 64 : 128;
  std::uint64_t bits = std::uint64_t(bytes.size()) * 8;
  for (int i = 0; i < 8; ++i) tail[tail_len - 1 - i] = static_cast<unsigned char>(bits >> (8 * i));
  for (std::size_t off = 0; off < tail_len; off += 64) sha256_block(h, tail + off);

  static const char kHex[] = "0123456789abcdef";
  std::string out;
  for (std::uint32_t word : h)
    for (int shift = 28; shift >= 0; shift -= 4) out += kHex[(word >> shift) & 0xf];
  return out;
}

}  // namespace forge_i18n
