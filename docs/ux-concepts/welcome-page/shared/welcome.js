/* ==========================================================================
   Welcome page prototypes: shared data, review state and prototype bar.
   Every concept reads the same dummy content from here, so the three pages
   differ only in structure. Nothing in this file talks to a server.
   ========================================================================== */
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var embed = params.has("embed");
  var draft = params.has("draft");

  /* ------------------------------------------------------------------------
     Review controls. The first option of each control is its default.
     ------------------------------------------------------------------------ */
  var CONTROLS = {
    android: { label: "Android", options: [["ok", "정상"], ["loading", "조회 중"], ["fail", "조회 실패"], ["hidden", "숨김"]] },
    ios: { label: "iOS", options: [["preparing", "준비 중"], ["testflight", "테스트 참여"], ["released", "출시"], ["hidden", "숨김"]] },
    rules: { label: "회칙", options: [["short", "짧은 정상본"], ["long", "긴 검증본"], ["none", "미등록"]] },
    staff: { label: "운영진", options: [["three", "3명"], ["many", "8명, 긴 이름"], ["none", "0명"]] },
    page: { label: "게시본", options: [["ok", "정상"], ["loading", "불러오는 중"], ["error", "조회 실패"]] }
  };

  var state = { theme: "system", device: "desktop", motion: "on" };
  var config = { name: "", key: "", controls: [] };
  var listeners = [];

  /* ------------------------------------------------------------------------
     Dummy content. Rule text and officer names are examples, labelled as
     such wherever they are rendered. No founding year, record, photo or
     contact detail is invented here.
     ------------------------------------------------------------------------ */
  var WEB_URL = "https://gyungchung.vercel.app/";
  var APK_URL = "https://github.com/jaywapp/gyungchung-releases/releases/latest/download/gyungchung-latest.apk";

  var COPY = {
    title: "경충FC에 오신 것을 환영합니다",
    intro: "회칙과 운영진을 확인하고 앱으로 함께 시작하세요",
    download: "Android 앱 다운로드",
    rules: "회칙 보기",
    web: "웹으로 이용하기",
    account: "계정 등록은 운영진에게 요청해 주세요. 안내받은 전화번호와 초기 비밀번호로 로그인한 뒤 새 비밀번호를 설정합니다.",
    accountSteps: [
      ["계정 등록 요청", "운영진에게 계정 등록을 요청합니다."],
      ["첫 로그인", "안내받은 전화번호와 초기 비밀번호로 로그인합니다."],
      ["비밀번호 변경", "새 비밀번호를 설정하면 준비가 끝납니다."]
    ],
    installSteps: [
      ["내려받기", "APK 파일을 내려받습니다."],
      ["파일 열기", "Android 기기에서 내려받은 파일을 엽니다. 안내가 나오면 이 출처의 설치를 허용합니다."],
      ["설치", "기존 앱이 있으면 삭제하지 않고 그대로 설치해 업데이트합니다."]
    ],
    rulesExample: "시안용 예시입니다. 실제 회칙이 아닙니다.",
    staffExample: "시안용 예시입니다. 실제 운영진 정보가 아닙니다."
  };

  var CHAPTERS = [
    { no: "제1장", title: "총칙", articles: [
      { n: 1, t: "목적", p: ["이 회칙은 경충FC(이하 '모임')의 운영 원칙과 회원의 권리와 의무를 정해, 모두가 안전하고 즐겁게 풋살을 하는 것을 목적으로 한다."],
        more: ["모임은 승패보다 꾸준한 참여와 서로에 대한 존중을 우선한다. 이 회칙에 정하지 않은 사항은 운영진이 회원의 의견을 들어 정하고 그 결과를 공지한다."] },
      { n: 2, t: "명칭", p: ["모임의 명칭은 경충FC로 한다."] },
      { n: 3, t: "활동", p: ["정기 운동은 운영진이 공지한 일정과 장소에서 한다. 일정은 앱과 웹의 일정 화면에 올리고, 변경이 있으면 지체 없이 다시 공지한다."] }
    ] },
    { no: "제2장", title: "회원", articles: [
      { n: 4, t: "가입", p: ["가입을 원하는 사람은 운영진에게 요청한다. 운영진이 계정을 등록하면 회원 자격이 시작된다."],
        more: ["가입 전에 ○회까지 정기 운동에 참관할 수 있다. 참관 기간의 참가비는 제4장에서 정한 바에 따른다."] },
      { n: 5, t: "권리", p: ["회원은 다음의 권리를 가진다."], l: ["정기 운동과 모임 행사에 참여한다.", "운영에 관한 의견을 내고 답변을 받는다.", "회비 사용 내역을 확인한다."] },
      { n: 6, t: "의무", p: ["회원은 다음의 의무를 진다."], l: ["참석 여부를 정해진 기한 안에 응답한다.", "회비를 기한 안에 납부한다.", "경기 중 상대를 존중하고 안전 수칙을 지킨다."],
        more: ["참석으로 응답한 뒤 사정이 생기면 가능한 한 빨리 응답을 바꾼다. 정원이 찬 일정에서는 대기 회원이 참여할 수 있도록 미리 알린다."] },
      { n: 7, t: "탈퇴와 휴회", p: ["탈퇴나 휴회를 원하는 회원은 운영진에게 알린다. 휴회 기간에는 월회비를 내지 않는다."] }
    ] },
    { no: "제3장", title: "운영진", articles: [
      { n: 8, t: "구성", p: ["운영진은 회장, 부회장, 총무로 구성한다. 필요하면 담당을 추가로 둘 수 있다."] },
      { n: 9, t: "임기", p: ["운영진의 임기는 ○년으로 하고 연임할 수 있다."] },
      { n: 10, t: "역할", p: ["운영진의 역할은 다음과 같다."], l: ["회장은 모임을 대표하고 운영 전반을 맡는다.", "부회장은 회장을 돕고 일정과 구장을 맡는다.", "총무는 회비와 장비를 관리하고 내역을 공개한다."] }
    ] },
    { no: "제4장", title: "회비", articles: [
      { n: 11, t: "월회비", p: ["월회비는 ○○원으로 하고 매월 ○일까지 납부한다."] },
      { n: 12, t: "참가비", p: ["회원이 아닌 참가자는 회당 참가비 ○○원을 낸다."] },
      { n: 13, t: "면제", p: ["부상이나 장기 출장처럼 운영진이 인정한 사유가 있으면 해당 기간의 회비를 면제할 수 있다."],
        more: ["면제 사유와 기간은 총무가 기록하고, 회원은 자신의 납부 내역에서 면제 여부를 확인할 수 있다. 사유가 끝나면 다음 달부터 월회비를 다시 낸다."] }
    ] },
    { no: "제5장", title: "경기 운영", longOnly: true, articles: [
      { n: 14, t: "참석 응답", p: ["회원은 일정마다 참석 또는 불참으로 응답한다. 응답 기한은 일정 공지에 적고, 기한이 지나면 운영진이 정원과 팀 구성을 확정한다.", "정원을 넘는 응답은 응답 순서에 따라 대기로 둔다. 불참으로 바뀐 자리는 대기 순서대로 채운다."] },
      { n: 15, t: "팀 구성", p: ["팀은 참석 인원과 포지션을 고려해 운영진이 나눈다. 같은 사람끼리만 반복해서 묶이지 않도록 일정마다 다시 구성한다."] },
      { n: 16, t: "안전", p: ["모든 참가자는 다음 수칙을 지킨다."], l: ["경기 전 준비 운동을 한다.", "위험한 태클과 뒤에서의 접촉을 하지 않는다.", "부상이 생기면 경기를 멈추고 상태를 먼저 확인한다.", "구장의 이용 수칙과 정리 시간을 지킨다."] },
      { n: 17, t: "장비", p: ["공과 조끼 같은 공용 장비는 모임 회비로 마련하고 총무가 관리한다. 개인 장비는 각자 준비한다."] }
    ] },
    { no: "제6장", title: "상벌", longOnly: true, articles: [
      { n: 18, t: "주의와 경고", p: ["응답 없이 불참하거나 안전 수칙을 어긴 회원에게 운영진은 주의 또는 경고를 줄 수 있다. 운영진은 그 사유를 당사자에게 먼저 알린다."] },
      { n: 19, t: "자격 정지", p: ["경고가 반복되거나 다른 회원에게 피해를 준 경우 운영진은 일정 기간 참여를 제한할 수 있다. 당사자는 운영진에게 의견을 낼 수 있고, 운영진은 그 의견을 듣고 결정한다."] }
    ] },
    { no: "제7장", title: "회의", longOnly: true, articles: [
      { n: 20, t: "정기 총회", p: ["정기 총회는 매년 ○월에 연다. 회비 결산과 다음 해 운영 계획을 보고하고 운영진을 선출한다."] },
      { n: 21, t: "의결", p: ["총회의 안건은 참석 회원 과반수의 찬성으로 정한다. 회칙 개정과 운영진 선출은 앱과 웹의 투표로 진행할 수 있다."] }
    ] },
    { no: "부칙", title: "시행과 개정", longOnly: true, articles: [
      { n: 22, t: "시행", p: ["이 회칙은 공지한 날부터 시행한다."] },
      { n: 23, t: "개정", p: ["회칙을 고칠 때는 고치는 내용과 이유를 미리 공지하고 총회의 의결을 거친다."] }
    ] }
  ];

  var STAFF = {
    three: [
      { name: "운영진 이름 예시 1", role: "회장", bio: "예시 소개입니다. 모임 운영 전반을 맡습니다." },
      { name: "운영진 이름 예시 2", role: "부회장", bio: "예시 소개입니다. 일정 조율과 구장 예약을 맡습니다." },
      { name: "운영진 이름 예시 3", role: "총무", bio: "예시 소개입니다. 회비 정산과 장비 관리를 맡습니다." }
    ],
    many: [
      { name: "운영진 이름 예시 1", role: "회장", bio: "예시 소개입니다. 모임 운영 전반을 맡습니다." },
      { name: "운영진 이름 예시 2", role: "부회장", bio: "예시 소개입니다. 일정 조율과 구장 예약을 맡습니다." },
      { name: "운영진 이름 예시 3", role: "총무", bio: "예시 소개입니다. 회비 정산과 장비 관리를 맡습니다." },
      { name: "아주 긴 운영진 공개 이름 예시 네 번째", role: "경기 운영 및 신입 회원 안내 담당", bio: "예시 소개입니다. 이름과 직책이 길 때 줄바꿈과 정렬을 확인하기 위한 항목입니다. 소개가 여러 문장으로 길어져도 옆 항목과 겹치지 않아야 합니다." },
      { name: "운영진 이름 예시 5", role: "장비 담당", bio: "예시 소개입니다." },
      { name: "운영진 이름 예시 6", role: "영상 기록 담당", bio: "예시 소개입니다. 경기 영상을 정리합니다." },
      { name: "운영진 이름 예시 7", role: "감사", bio: "예시 소개입니다. 회비 내역을 확인합니다." },
      { name: "운영진 이름 예시 8", role: "고문", bio: "" }
    ],
    none: []
  };

  function rules() {
    if (state.rules === "none") return null;
    var long = state.rules === "long";
    var chapters = CHAPTERS.filter(function (c) { return long || !c.longOnly; }).map(function (c, ci) {
      return {
        id: "ch" + (ci + 1), no: c.no, title: c.title,
        articles: c.articles.map(function (a) {
          return { id: "a" + a.n, n: a.n, label: "제" + a.n + "조", title: a.t, paras: long && a.more ? a.p.concat(a.more) : a.p, list: a.l || [] };
        })
      };
    });
    var count = chapters.reduce(function (s, c) { return s + c.articles.length; }, 0);
    return {
      title: "경충FC 회칙",
      effective: "2026. 10. 1. 시행",
      revised: long ? "2026. 10. 1. 개정" : null,
      chapters: chapters,
      articleCount: count
    };
  }

  function staff() { return STAFF[state.staff] || []; }

  function android() {
    var s = state.android;
    return {
      status: s,
      url: APK_URL,
      version: s === "ok" ? "0.1.0" : null,
      size: s === "ok" ? "85.6 MB" : null,
      checked: "2026-10-02 확인",
      message: s === "loading" ? "버전 정보를 확인하는 중입니다."
        : s === "fail" ? "버전 정보를 불러오지 못했습니다. 최신 설치 파일은 그대로 받을 수 있습니다."
        : null
    };
  }

  function ios() {
    var s = state.ios;
    if (s === "hidden") return null;
    if (s === "testflight") return { status: s, title: "iOS 테스트 참여", note: "TestFlight에서 테스트 버전을 설치합니다.", action: "TestFlight에서 참여" };
    if (s === "released") return { status: s, title: "iOS 앱", note: "App Store에서 설치합니다.", action: "App Store에서 받기" };
    return { status: s, title: "iOS 앱 출시 준비 중", note: "출시 전까지는 웹으로 이용해 주세요.", action: null };
  }

  /* ------------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------------ */
  function esc(v) {
    return String(v).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  function icon(name, cls) {
    return '<svg class="ic' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true">' + (window.W_ICONS[name] || "") + "</svg>";
  }

  function hydrateIcons(root) {
    (root || document).querySelectorAll("i[data-ic]").forEach(function (el) {
      var t = document.createElement("template");
      t.innerHTML = icon(el.getAttribute("data-ic"), el.className);
      el.replaceWith(t.content.firstChild);
    });
  }

  function logo(cls) {
    var base = "../../../../public/brand/gcfc-logo-horizontal-";
    return '<span class="gcfc-logo' + (cls ? " " + cls : "") + '"><img class="on-light" src="' + base + 'light.svg" alt="GCFC 경충FC"><img class="on-dark" src="' + base + 'dark.svg" alt="GCFC 경충FC"></span>';
  }

  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  function applyTheme() {
    var t = state.theme === "system" ? (systemDark.matches ? "dark" : "light") : state.theme;
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.setAttribute("data-motion", state.motion);
  }
  systemDark.addEventListener("change", applyTheme);

  function reducedMotion() {
    return state.motion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /* ------------------------------------------------------------------------
     State
     ------------------------------------------------------------------------ */
  function defaults() {
    var d = { theme: "system", device: "desktop", motion: "on" };
    config.controls.forEach(function (c) { d[c.key] = c.options[0][0]; });
    return d;
  }

  function query(forFrame) {
    var d = defaults(), q = new URLSearchParams();
    if (forFrame) q.set("embed", "1");
    Object.keys(d).forEach(function (k) {
      if (forFrame && k === "device") return;
      if (state[k] !== d[k]) q.set(k, state[k]);
    });
    if (forFrame && state.theme === "system") q.set("theme", document.documentElement.getAttribute("data-theme"));
    return q.toString();
  }

  function set(key, value) {
    state[key] = value;
    applyTheme();
    if (!embed) {
      var q = query(false);
      history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
      renderBar();
      renderStage();
    }
    listeners.forEach(function (fn) { fn(state, key); });
  }

  /* ------------------------------------------------------------------------
     Prototype bar and device stage
     ------------------------------------------------------------------------ */
  var bar, stage;
  var DEVICES = [["desktop", "데스크톱", "monitor"], ["768", "768", "smartphone"], ["390", "390", "smartphone"], ["360", "360", "smartphone"]];
  var PAGES = [["concept-01", "01 순서형"], ["concept-02", "02 탐색형"], ["concept-03", "03 소개형"], ["admin", "관리자"]];

  function renderBar() {
    if (embed) return;
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "proto-bar";
      bar.setAttribute("role", "region");
      bar.setAttribute("aria-label", "시안 검토 도구");
      document.body.insertBefore(bar, document.body.firstChild);
      bar.addEventListener("click", function (e) {
        var b = e.target.closest("button[data-set]");
        if (b) set(b.getAttribute("data-set"), b.getAttribute("data-value"));
      });
      bar.addEventListener("change", function (e) {
        if (e.target.matches("select[data-set]")) set(e.target.getAttribute("data-set"), e.target.value);
      });
      new ResizeObserver(function () {
        document.documentElement.style.setProperty("--proto-h", bar.offsetHeight + "px");
      }).observe(bar);
    }
    var focusKey = document.activeElement && bar.contains(document.activeElement) ? document.activeElement.getAttribute("data-id") : null;
    var seg = function (key, items) {
      return '<span class="proto-seg">' + items.map(function (it) {
        return '<button type="button" data-id="' + key + it[0] + '" data-set="' + key + '" data-value="' + it[0] + '" aria-pressed="' + (state[key] === it[0]) + '">' + (it[2] ? icon(it[2]) : "") + esc(it[1]) + "</button>";
      }).join("") + "</span>";
    };
    var selects = config.controls.map(function (c) {
      return '<label class="proto-field">' + esc(c.label) + '<select data-id="sel' + c.key + '" data-set="' + c.key + '">' + c.options.map(function (o) {
        return '<option value="' + o[0] + '"' + (state[c.key] === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>";
      }).join("") + "</select></label>";
    }).join("");
    bar.innerHTML =
      '<div class="proto-name"><small>웰컴 페이지 시안 · 검토용 도구</small><b>' + esc(config.name) + "</b></div>" +
      '<nav class="proto-links" aria-label="다른 시안">' + PAGES.map(function (p) {
        return '<a href="../' + p[0] + '/index.html"' + (p[0] === config.key ? ' aria-current="page"' : "") + ">" + p[1] + "</a>";
      }).join("") + "</nav>" +
      '<div class="proto-group">' + seg("device", DEVICES) + seg("theme", [["system", "시스템"], ["light", "라이트", "sun"], ["dark", "다크", "moon"]]) +
      '<button type="button" class="proto-btn" data-id="motion" data-set="motion" data-value="' + (state.motion === "on" ? "off" : "on") + '" aria-pressed="' + (state.motion === "off") + '">정지 화면</button></div>' +
      '<div class="proto-group">' + selects + "</div>";
    if (focusKey) {
      var again = bar.querySelector('[data-id="' + focusKey + '"]');
      if (again) again.focus();
    }
  }

  function renderStage() {
    if (embed) return;
    var page = document.getElementById("page");
    var framed = state.device !== "desktop";
    if (page) page.hidden = framed;
    if (!framed) {
      if (stage) stage.hidden = true;
      return;
    }
    if (!stage) {
      stage = document.createElement("div");
      stage.className = "proto-stage";
      stage.innerHTML = '<figure><figcaption></figcaption><iframe title="기기 미리보기"></iframe></figure>';
      document.body.appendChild(stage);
    }
    stage.hidden = false;
    var w = Number(state.device);
    var frame = stage.querySelector("iframe");
    frame.className = w >= 700 ? "tablet" : "";
    frame.style.width = w + 16 + "px";
    frame.style.height = (w >= 700 ? 1024 : 800) + 16 + "px";
    stage.querySelector("figcaption").textContent = w + "px 기기 틀";
    var src = location.pathname + "?" + query(true) + location.hash;
    if (frame.getAttribute("data-src") !== src) {
      frame.setAttribute("data-src", src);
      frame.src = src;
    }
  }

  function init(options) {
    config.name = options.name;
    config.key = options.key;
    config.controls = (options.controls || []).map(function (c) {
      return typeof c === "string" ? { key: c, label: CONTROLS[c].label, options: CONTROLS[c].options } : c;
    });
    var d = defaults();
    Object.keys(d).forEach(function (k) { state[k] = params.get(k) || d[k]; });
    applyTheme();
    hydrateIcons(document);
    if (draft) {
      var banner = document.createElement("div");
      banner.className = "draft-banner";
      banner.setAttribute("role", "status");
      banner.innerHTML = icon("eye") + "초안 미리보기입니다. 아직 게시되지 않은 내용입니다.";
      document.body.insertBefore(banner, document.body.firstChild);
    }
    renderBar();
    renderStage();
  }

  window.W = {
    init: init,
    state: state,
    embed: embed,
    set: set,
    on: function (fn) { listeners.push(fn); },
    copy: COPY,
    webUrl: WEB_URL,
    rules: rules,
    staff: staff,
    android: android,
    ios: ios,
    icon: icon,
    hydrateIcons: hydrateIcons,
    logo: logo,
    esc: esc,
    reducedMotion: reducedMotion
  };
})();
