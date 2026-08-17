import { useState, useEffect } from "react";

const COURTS = ["A구장", "B구장", "C구장"];
const COLORS = { A구장: "#00B894", B구장: "#E17055", C구장: "#FDCB6E" };
const APP_NAME = "W 클럽";
const BANK_INFO = { bank: "신한은행", account: "110416951315, 김병조" };
const FEE_INFO = { base: "2시간 기준 : 8만원", extra: "추가 시간당 4만원" };

// ── 날짜 유틸 ─────────────────────────────────────────
// ── 날짜 문자열 정규화 (T이후 시간 제거) ─────────────
function normalizeDate(v) {
  if (!v) return v;
  return String(v).slice(0, 10);
}

// 한국 시간(KST, UTC+9) 기준 오늘 날짜 반환
function today() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
function dateLabel(d) {
  // 한국 시간 기준 날짜 표시
  return new Date(d + "T09:00:00").toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}
function nextDays(n = 30) {
  // 한국 시간 기준 날짜 목록 생성
  return Array.from({ length: n }, (_, i) => {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    kst.setDate(kst.getDate() + i);
    return kst.toISOString().slice(0, 10);
  });
}
function getDayType(dateStr, holidays) {
  if (holidays.includes(dateStr)) return "holiday";
  const dow = new Date(dateStr + "T09:00:00").getDay();
  if (dow === 0 || dow === 6) return "weekend";
  return "weekday";
}
function getSlots(dateStr, holidays) {
  const type = getDayType(dateStr, holidays);
  if (type === "weekday") {
    // 평일: 20:00~24:00, 2시간 단위
    return ["20:00~22:00", "22:00~24:00"];
  } else if (type === "weekend") {
    // 토·일: 12:00~24:00, 1시간 단위
    return Array.from({ length: 12 }, (_, i) => {
      const s = 12 + i; const e = s + 1;
      return `${String(s).padStart(2,"0")}:00~${String(e).padStart(2,"0")}:00`;
    });
  } else {
    // 공휴일: 10:00~24:00, 1시간 단위
    return Array.from({ length: 14 }, (_, i) => {
      const s = 10 + i; const e = s + 1;
      return `${String(s).padStart(2,"0")}:00~${String(e).padStart(2,"0")}:00`;
    });
  }
}
function dayTypeLabel(type) {
  return type === "weekday" ? "평일" : type === "weekend" ? "주말" : "공휴일";
}
function dayTypeBadgeStyle(type) {
  if (type === "weekday") return { background: "#e3f2fd", color: "#1565C0" };
  if (type === "weekend") return { background: "#f3e5f5", color: "#6A1B9A" };
  return { background: "#fce4ec", color: "#C62828" };
}

// ── 초기 데이터 ───────────────────────────────────────
const INIT_USERS = {
  admin: { pw: "admin123", role: "admin", name: "관리자", contact: "010-0000-0000" },
  user1: { pw: "user1234", role: "user", name: "홍길동", contact: "010-1234-5678" },
  user2: { pw: "user1234", role: "user", name: "김철수", contact: "010-9876-5432" },
};
const INIT_RESERVATIONS = [
  { id: 1, date: today(), court: "A구장", slot: "20:00~22:00", team: "FC번개", contact: "010-1234-5678", status: "pending", userId: "user1", cancelled: false, cancelRequested: false },
];
const INIT_NOTICES = [
  { id: 1, title: "운영 안내", content: "평일 20:00~24:00 / 주말·공휴일 별도 운영", date: today() },
];
const INIT_HOLIDAYS = [];

// ── Google Sheets API 설정 ────────────────────────────
// ★ 아래 URL을 Apps Script 배포 후 받은 웹앱 URL로 교체하세요
const GAS_URL = "https://script.google.com/macros/s/AKfycbzKEjINu8Gyo4LcLttCoHPez2pDuATdU6ou_Sa0MNjb267bo_MoJxSIwxP8aGKK9qbj/exec";

async function gasGet() {
  try {
    const res = await fetch(`${GAS_URL}?action=getAll`, {
      method: "GET",
      headers: { "Content-Type": "text/plain" },
    });
    const text = await res.text();
    return JSON.parse(text);
  } catch(e) { console.error("GAS GET 오류:", e); return null; }
}
async function gasPost(action, data) {
  try {
    const res = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action, data }),
    });
    return await res.json();
  } catch(e) { console.error("GAS POST 오류:", e); return null; }
}

// ══════════════════════════════════════════════════════
// 최상위
// ══════════════════════════════════════════════════════
export default function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [users, setUsers] = useState(INIT_USERS);
  const [reservations, setReservations] = useState(INIT_RESERVATIONS);
  const [notices, setNotices] = useState(INIT_NOTICES);
  const [holidays, setHolidays] = useState(INIT_HOLIDAYS);
  const [nextId, setNextId] = useState(20);
  const [authScreen, setAuthScreen] = useState("login");

  // 최초 로드: Google Sheets에서 전체 데이터 가져오기
  useEffect(() => {
    (async () => {
      const data = await gasGet();
      if (data && !data.error) {
        if (data.users && data.users.length > 0) {
          const usersObj = {};
          data.users.forEach(u => { usersObj[u.id] = { pw: u.pw, role: u.role, name: u.name, contact: u.contact }; });
          setUsers(usersObj);
        }
        if (data.reservations) {
          // 날짜 필드 정규화 (T이후 시간 제거)
          setReservations(data.reservations.map(r => ({ ...r, date: normalizeDate(r.date) })));
        }
        if (data.notices) {
          setNotices(data.notices.map(n => ({ ...n, date: normalizeDate(n.date) })));
        }
        if (data.holidays) {
          setHolidays(data.holidays.map(h => normalizeDate(h)));
        }
      }
      setReady(true);
    })();
  }, []);

  // 변경 시 Google Sheets에 저장 (debounce 500ms)
  useEffect(() => {
    if (!ready) return;
    const usersArr = Object.entries(users).map(([id, u]) => ({ id, ...u }));
    const timer = setTimeout(() => {
      gasPost("saveSheet", { sheet: "users", rows: usersArr });
    }, 500);
    return () => clearTimeout(timer);
  }, [users, ready]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      gasPost("saveSheet", { sheet: "reservations", rows: reservations });
    }, 500);
    return () => clearTimeout(timer);
  }, [reservations, ready]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      gasPost("saveSheet", { sheet: "notices", rows: notices });
    }, 500);
    return () => clearTimeout(timer);
  }, [notices, ready]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      gasPost("saveSheet", { sheet: "holidays", rows: holidays });
    }, 500);
    return () => clearTimeout(timer);
  }, [holidays, ready]);

  const genId = () => { const id = nextId; setNextId(p => p + 1); return id; };

  if (!ready) return (
    <div style={{ ...S.page, alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontSize: 40 }}>⚽</div>
      <p style={{ color: S.textMuted, marginTop: 12 }}>불러오는 중...</p>
    </div>
  );

  if (!user) {
    if (authScreen === "register") return <RegisterScreen users={users} setUsers={setUsers} onBack={() => setAuthScreen("login")} onSuccess={() => setAuthScreen("login")} />;
    if (authScreen === "findpw") return <FindPwScreen users={users} onBack={() => setAuthScreen("login")} />;
    return <LoginScreen users={users} onLogin={setUser} onGoRegister={() => setAuthScreen("register")} onGoFindPw={() => setAuthScreen("findpw")} />;
  }
  if (user.role === "admin")
    return <AdminApp user={user} setUser={setUser} reservations={reservations} setReservations={setReservations}
      notices={notices} setNotices={setNotices} holidays={holidays} setHolidays={setHolidays} genId={genId} />;
  return <UserApp user={user} setUser={setUser} reservations={reservations} setReservations={setReservations}
    notices={notices} holidays={holidays} genId={genId} />;
}

// ══════════════════════════════════════════════════════
// 인증 화면
// ══════════════════════════════════════════════════════
function LoginScreen({ users, onLogin, onGoRegister, onGoFindPw }) {
  const [id, setId] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState("");
  const login = () => {
    // 한글 팀명 대응: trim() 으로 앞뒤 공백 제거 후 비교
    const trimId = id.trim();
    const trimPw = pw.trim();
    const u = users[trimId];
    if (!u || u.pw.trim() !== trimPw) { setErr("아이디 또는 비밀번호가 올바르지 않습니다."); return; }
    onLogin({ id: trimId, ...u });
  };
  return (
    <div style={S.page}>
      <div style={{ ...S.card, maxWidth: 380, margin: "auto", marginTop: 80 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 52 }}>⚽</div>
          <h1 style={{ color: S.textPrimary, fontSize: 22, margin: "8px 0 4px" }}>{APP_NAME}</h1>
          <p style={{ color: S.textMuted, fontSize: 13 }}>구장 예약 서비스</p>
        </div>
        <Input label="팀명 (아이디)" value={id} onChange={setId} placeholder="팀명 입력" />
        <Input label="비밀번호" value={pw} onChange={setPw} type="password" placeholder="비밀번호 입력" onEnter={login} />
        {err && <p style={{ color: "#E17055", fontSize: 12, margin: "4px 0 8px" }}>{err}</p>}
        <Btn onClick={login} style={{ width: "100%", marginTop: 8 }}>로그인</Btn>

        <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 14 }}>
          <button onClick={onGoRegister} style={S.linkBtn}>회원가입</button>
          <span style={{ color: "#ddd", fontSize: 12 }}>|</span>
          <button onClick={onGoFindPw} style={S.linkBtn}>비밀번호 찾기</button>
        </div>
      </div>
    </div>
  );
}

function RegisterScreen({ users, setUsers, onBack, onSuccess }) {
  const [form, setForm] = useState({ team: "", pw: "", pw2: "", name: "", contact: "" });
  const [err, setErr] = useState(""); const [done, setDone] = useState(false);
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const submit = () => {
    // 한글 팀명 대응: 모든 입력값 trim() 처리
    const trimTeam = form.team.trim();
    const trimPw = form.pw.trim();
    const trimPw2 = form.pw2.trim();
    const trimName = form.name.trim();
    const trimContact = form.contact.trim();

    if (!trimTeam || !trimPw || !trimName || !trimContact) { setErr("모든 항목을 입력해주세요."); return; }
    if (users[trimTeam]) { setErr("이미 사용 중인 팀명입니다."); return; }
    if (trimPw.length < 6) { setErr("비밀번호는 6자 이상이어야 합니다."); return; }
    if (trimPw !== trimPw2) { setErr("비밀번호가 일치하지 않습니다."); return; }
    setUsers(p => ({ ...p, [trimTeam]: { pw: trimPw, role: "user", name: trimName, contact: trimContact } }));
    setDone(true);
  };
  if (done) return (
    <div style={S.page}><div style={{ ...S.card, maxWidth: 380, margin: "auto", marginTop: 80, textAlign: "center" }}>
      <div style={{ fontSize: 52 }}>🎉</div>
      <h2 style={{ color: S.textPrimary, marginTop: 12 }}>가입 완료!</h2>
      <p style={{ color: S.textMuted, fontSize: 14, marginTop: 8 }}><b style={{ color: "#00B894" }}>{form.team}</b> 팀으로 가입되었습니다.</p>
      <Btn onClick={onSuccess} style={{ marginTop: 24, width: "100%" }}>로그인하러 가기</Btn>
    </div></div>
  );
  return (
    <div style={S.page}><div style={{ ...S.card, maxWidth: 380, margin: "auto", marginTop: 60 }}>
      <BackHeader title="회원가입" onBack={onBack} />
      <Input label="팀명 (아이디)" value={form.team} onChange={v => f("team", v)} placeholder="팀명 (로그인 ID)" />
      <Input label="이름 (대표자)" value={form.name} onChange={v => f("name", v)} placeholder="대표자 이름" />
      <Input label="연락처" value={form.contact} onChange={v => f("contact", v)} placeholder="010-0000-0000" />
      <Input label="비밀번호" value={form.pw} onChange={v => f("pw", v)} type="password" placeholder="6자 이상" />
      <Input label="비밀번호 확인" value={form.pw2} onChange={v => f("pw2", v)} type="password" placeholder="비밀번호 재입력" />
      {err && <p style={{ color: "#E17055", fontSize: 12, margin: "4px 0 8px" }}>{err}</p>}
      <Btn onClick={submit} style={{ width: "100%", marginTop: 8 }}>가입하기</Btn>
      <div style={{ textAlign: "center", marginTop: 14 }}>
        <button onClick={onBack} style={S.linkBtn}>이미 계정이 있어요 → 로그인</button>
      </div>
    </div></div>
  );
}

function FindPwScreen({ users, onBack }) {
  const [team, setTeam] = useState(""); const [name, setName] = useState(""); const [contact, setContact] = useState("");
  const [result, setResult] = useState(null); const [foundPw, setFoundPw] = useState("");
  const find = () => {
    const u = users[team];
    if (u && u.name === name && u.contact === contact) { setFoundPw(u.pw); setResult("found"); }
    else setResult("notfound");
  };
  return (
    <div style={S.page}><div style={{ ...S.card, maxWidth: 380, margin: "auto", marginTop: 80 }}>
      <BackHeader title="비밀번호 찾기" onBack={onBack} />
      <p style={{ color: S.textMuted, fontSize: 13, marginBottom: 16 }}>가입 시 입력한 정보로 비밀번호를 확인할 수 있어요.</p>
      <Input label="팀명" value={team} onChange={setTeam} placeholder="팀명 입력" />
      <Input label="이름 (대표자)" value={name} onChange={setName} placeholder="대표자 이름" />
      <Input label="연락처" value={contact} onChange={setContact} placeholder="010-0000-0000" />
      <Btn onClick={find} style={{ width: "100%", marginTop: 8 }}>확인하기</Btn>
      {result === "found" && (
        <div style={{ marginTop: 16, padding: 14, background: "#e8f5e9", borderRadius: 12, border: "1px solid #a5d6a7", textAlign: "center" }}>
          <p style={{ color: "#2e7d32", fontSize: 13, marginBottom: 6 }}>✅ 비밀번호를 찾았어요!</p>
          <p style={{ color: "#1b5e20", fontWeight: 700, fontSize: 18, letterSpacing: 2 }}>{foundPw}</p>
        </div>
      )}
      {result === "notfound" && (
        <div style={{ marginTop: 16, padding: 12, background: "#fdecea", borderRadius: 12, textAlign: "center" }}>
          <p style={{ color: "#E17055", fontSize: 13 }}>❌ 일치하는 계정을 찾을 수 없어요.</p>
        </div>
      )}
      <div style={{ textAlign: "center", marginTop: 14 }}>
        <button onClick={onBack} style={S.linkBtn}>로그인으로 돌아가기</button>
      </div>
    </div></div>
  );
}

// ══════════════════════════════════════════════════════
// 일반 사용자 앱
// ══════════════════════════════════════════════════════
function UserApp({ user, setUser, reservations, setReservations, notices, holidays, genId }) {
  const [tab, setTab] = useState("home");
  const tabs = [{ key: "home", label: "홈", icon: "🏠" }, { key: "reserve", label: "예약", icon: "📅" }, { key: "mypage", label: "내 예약", icon: "👤" }];
  return (
    <div style={S.page}>
      <TopBar title={APP_NAME} user={user} onLogout={() => setUser(null)} />
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 70 }}>
        {tab === "home" && <HomeTab notices={notices} reservations={reservations} holidays={holidays} />}
        {tab === "reserve" && <ReserveTab user={user} reservations={reservations} setReservations={setReservations} holidays={holidays} genId={genId} />}
        {tab === "mypage" && <MyPageTab user={user} reservations={reservations} setReservations={setReservations} />}
      </div>
      <BottomNav tabs={tabs} active={tab} onChange={setTab} />
    </div>
  );
}

function HomeTab({ notices, reservations, holidays }) {
  const [selDate, setSelDate] = useState(today());
  const days = nextDays(14);
  const slots = getSlots(selDate, holidays);
  const dayType = getDayType(selDate, holidays);
  const activeRes = reservations.filter(r => r.date === selDate && !r.cancelled);

  return (
    <div style={S.section}>
      <NoticeBar notices={notices} />
      <h2 style={S.sectionTitle}>날짜 선택</h2>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8 }}>
        {days.map(d => {
          const dt = getDayType(d, holidays);
          return (
            <button key={d} onClick={() => setSelDate(d)} style={{ ...S.datePill, background: selDate === d ? "#00B894" : "#f0f0f0", color: selDate === d ? "#fff" : "#666", fontWeight: selDate === d ? 700 : 400 }}>
              <div style={{ fontSize: 10 }}>{new Date(d + "T00:00:00").toLocaleDateString("ko-KR", { weekday: "short" })}</div>
              <div style={{ fontSize: 15 }}>{new Date(d + "T00:00:00").getDate()}</div>
              {dt !== "weekday" && <div style={{ fontSize: 9, color: selDate === d ? "#ceffee" : dt === "holiday" ? "#C62828" : "#6A1B9A" }}>{dt === "holiday" ? "공휴" : "주말"}</div>}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, marginBottom: 10 }}>
        <h2 style={{ ...S.sectionTitle, margin: 0 }}>예약 현황</h2>
        <span style={{ ...dayTypeBadgeStyle(dayType), fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{dayTypeLabel(dayType)}</span>
      </div>
      <p style={{ color: S.textMuted, fontSize: 12, marginBottom: 10 }}>{dateLabel(selDate)}</p>

      {COURTS.map(court => (
        <div key={court} style={{ ...S.card, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: COLORS[court] }} />
            <span style={{ color: S.textPrimary, fontWeight: 700 }}>{court}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {slots.map(slot => {
              const res = activeRes.find(r => r.court === court && r.slot === slot);
              return (
                <div key={slot} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: S.textMuted, fontSize: 11, width: 96, flexShrink: 0 }}>{slot}</span>
                  <div style={{ flex: 1, padding: "4px 10px", borderRadius: 7, fontSize: 12, background: res ? "#e8f5e9" : "#f9f9f9", color: res ? "#2e7d32" : "#bbb", border: `1px solid ${res ? "#a5d6a7" : "#eee"}`, display: "flex", alignItems: "center", gap: 5 }}>
                    {res ? <>✅ {res.team} <span style={res.status === "confirmed" ? S.badgeConfirmed : S.badgePending}>{res.status === "confirmed" ? "확" : "예"}</span></> : "예약 가능"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function FeeCard() {
  return (
    <div style={{ background: "#f0faf7", border: "1px solid #b2dfdb", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
      <p style={{ color: "#00796B", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>💰 구장이용료 안내</p>
      <p style={{ color: "#444", fontSize: 13 }}>· {FEE_INFO.base}</p>
      <p style={{ color: "#444", fontSize: 13 }}>· {FEE_INFO.extra}</p>
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #b2dfdb" }}>
        <p style={{ color: "#00796B", fontSize: 12, fontWeight: 600 }}>입금 계좌</p>
        <p style={{ color: "#333", fontSize: 13, fontWeight: 700 }}>{BANK_INFO.bank} &nbsp; {BANK_INFO.account}</p>
        <p style={{ color: "#999", fontSize: 11, marginTop: 4 }}>※ 입금 확인 후 예약이 최종 확정됩니다.</p>
      </div>
    </div>
  );
}

function ReserveTab({ user, reservations, setReservations, holidays, genId }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ date: today(), court: "", slot: "", team: user.id, contact: user.contact || "" });
  const [done, setDone] = useState(false);
  const days = nextDays(30);
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const slots = getSlots(form.date, holidays);
  const dayType = getDayType(form.date, holidays);
  const isSlotTaken = (court, slot) => reservations.some(r => r.date === form.date && r.court === court && r.slot === slot && !r.cancelled);

  const submit = () => {
    if (!form.team || !form.contact) return;
    setReservations(p => [...p, { id: genId(), ...form, status: "pending", userId: user.id, cancelled: false }]);
    setDone(true);
  };

  const reset = () => { setDone(false); setStep(1); setForm({ date: today(), court: "", slot: "", team: user.id, contact: user.contact || "" }); };

  if (done) return (
    <div style={{ ...S.section, textAlign: "center", paddingTop: 60 }}>
      <div style={{ fontSize: 60 }}>🎉</div>
      <h2 style={{ color: S.textPrimary, marginTop: 12 }}>예약 신청 완료!</h2>
      <p style={{ color: S.textMuted, fontSize: 13 }}>{form.court} · {form.slot}</p>
      <p style={{ color: "#00B894", fontWeight: 700, fontSize: 16, marginTop: 4 }}>{form.team}</p>
      <div style={{ ...S.card, marginTop: 20, textAlign: "left" }}>
        <p style={{ color: "#E17055", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>💳 입금 안내</p>
        <p style={{ color: "#444", fontSize: 13 }}>· {FEE_INFO.base}</p>
        <p style={{ color: "#444", fontSize: 13 }}>· {FEE_INFO.extra}</p>
        <p style={{ color: "#333", fontSize: 13, marginTop: 8, fontWeight: 700 }}>{BANK_INFO.bank} {BANK_INFO.account}</p>
        <p style={{ color: "#999", fontSize: 11, marginTop: 6 }}>입금 확인 후 관리자가 예약을 확정합니다.</p>
      </div>
      <Btn onClick={reset} style={{ marginTop: 20 }}>새 예약하기</Btn>
    </div>
  );

  return (
    <div style={S.section}>
      <StepIndicator current={step} total={3} labels={["날짜·구장", "시간대", "팀 정보"]} />

      {step === 1 && <>
        <h2 style={S.sectionTitle}>날짜 선택</h2>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, marginBottom: 16 }}>
          {days.map(d => {
            const dt = getDayType(d, holidays);
            return (
              <button key={d} onClick={() => f("date", d)} style={{ ...S.datePill, background: form.date === d ? "#00B894" : "#f0f0f0", color: form.date === d ? "#fff" : "#666" }}>
                <div style={{ fontSize: 10 }}>{new Date(d + "T00:00:00").toLocaleDateString("ko-KR", { weekday: "short" })}</div>
                <div style={{ fontSize: 15 }}>{new Date(d + "T00:00:00").getDate()}</div>
                {dt !== "weekday" && <div style={{ fontSize: 9, color: form.date === d ? "#ceffee" : dt === "holiday" ? "#C62828" : "#6A1B9A" }}>{dt === "holiday" ? "공휴" : "주말"}</div>}
              </button>
            );
          })}
        </div>
        <h2 style={S.sectionTitle}>구장 선택</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {COURTS.map(c => (
            <button key={c} onClick={() => f("court", c)} style={{ ...S.courtBtn, background: form.court === c ? COLORS[c] : "#f0f0f0", color: form.court === c ? "#fff" : "#555", border: `2px solid ${form.court === c ? COLORS[c] : "#e0e0e0"}` }}>{c}</button>
          ))}
        </div>
        <Btn onClick={() => form.court && setStep(2)} style={{ marginTop: 24, width: "100%" }} disabled={!form.court}>다음 →</Btn>
      </>}

      {step === 2 && <>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <h2 style={{ ...S.sectionTitle, margin: 0 }}>시간대 선택</h2>
          <span style={{ ...dayTypeBadgeStyle(dayType), fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{dayTypeLabel(dayType)}</span>
        </div>
        <p style={{ color: S.textMuted, fontSize: 12, marginBottom: 12 }}>{dateLabel(form.date)} · {form.court}</p>
        <div style={{ maxHeight: 380, overflowY: "auto", paddingRight: 2 }}>
          {slots.map((slot, i) => {
            const taken = isSlotTaken(form.court, slot);
            return (
              <button key={slot} disabled={taken} onClick={() => f("slot", slot)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "12px 14px", borderRadius: 10, marginBottom: 8, background: taken ? "#f5f5f5" : form.slot === slot ? "#00B89422" : "#fff", border: `2px solid ${taken ? "#eee" : form.slot === slot ? "#00B894" : "#e8e8e8"}`, color: taken ? "#bbb" : S.textPrimary, cursor: taken ? "not-allowed" : "pointer" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{slot}</span>
                <span style={{ fontSize: 12 }}>{taken ? "❌ 예약완료" : "✅ 예약가능"}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Btn onClick={() => setStep(1)} style={{ flex: 1, background: "#f0f0f0", color: "#555" }}>← 이전</Btn>
          <Btn onClick={() => form.slot && setStep(3)} style={{ flex: 1 }} disabled={!form.slot}>다음 →</Btn>
        </div>
      </>}

      {step === 3 && <>
        <h2 style={S.sectionTitle}>팀 정보 확인</h2>
        <div style={{ ...S.card, marginBottom: 16 }}>
          <Row label="날짜" value={dateLabel(form.date)} />
          <Row label="구장" value={form.court} />
          <Row label="시간" value={form.slot} />
        </div>
        <FeeCard />
        <Input label="팀명" value={form.team} onChange={v => f("team", v)} placeholder="팀명" />
        <Input label="연락처" value={form.contact} onChange={v => f("contact", v)} placeholder="010-0000-0000" />
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Btn onClick={() => setStep(2)} style={{ flex: 1, background: "#f0f0f0", color: "#555" }}>← 이전</Btn>
          <Btn onClick={submit} style={{ flex: 1, background: "#00B894" }} disabled={!form.team || !form.contact}>예약 신청</Btn>
        </div>
      </>}
    </div>
  );
}

function MyPageTab({ user, reservations, setReservations }) {
  const myRes = reservations.filter(r => r.userId === user.id);
  // 취소 요청 (관리자 승인 전까지 cancelRequested만 true)
  const requestCancel = (id) => setReservations(p => p.map(r => r.id === id ? { ...r, cancelRequested: true } : r));

  return (
    <div style={S.section}>
      <div style={{ ...S.card, marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#00B894", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>👤</div>
        <div>
          <p style={{ color: S.textPrimary, fontWeight: 700 }}>{user.name}</p>
          <p style={{ color: S.textMuted, fontSize: 12 }}>팀명: {user.id} · {user.contact}</p>
        </div>
      </div>
      <h2 style={S.sectionTitle}>내 예약 내역</h2>
      {myRes.length === 0 && <Empty text="예약 내역이 없습니다" />}
      {myRes.map(r => (
        <div key={r.id} style={{ ...S.card, marginBottom: 10, opacity: r.cancelled ? 0.55 : 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <CourtDot court={r.court} />
                <span style={{ color: S.textPrimary, fontWeight: 700 }}>{r.court}</span>
                {r.cancelled
                  ? <span style={S.badgeCancelled}>취소완료</span>
                  : r.cancelRequested
                    ? <span style={S.badgeCancelReq}>취소대기</span>
                    : <span style={r.status === "confirmed" ? S.badgeConfirmed : S.badgePending}>{r.status === "confirmed" ? "확" : "예"}</span>
                }
              </div>
              <p style={{ color: S.textMuted, fontSize: 12, marginTop: 6 }}>{dateLabel(r.date)}</p>
              <p style={{ color: "#777", fontSize: 12 }}>{r.slot} · {r.team}</p>
              {!r.cancelled && !r.cancelRequested && r.status === "pending" &&
                <p style={{ color: "#E17055", fontSize: 11, marginTop: 4 }}>💳 입금 후 관리자 확정 대기 중</p>}
              {r.cancelRequested && !r.cancelled &&
                <p style={{ color: "#888", fontSize: 11, marginTop: 4 }}>⏳ 취소 요청 중 · 관리자 승인 대기</p>}
            </div>
            {!r.cancelled && !r.cancelRequested && (
              <button onClick={() => requestCancel(r.id)} style={{ color: "#E17055", fontSize: 12, background: "none", border: "none", cursor: "pointer", flexShrink: 0, marginLeft: 8 }}>취소요청</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// 관리자 앱
// ══════════════════════════════════════════════════════
function AdminApp({ user, setUser, reservations, setReservations, notices, setNotices, holidays, setHolidays, genId }) {
  const [tab, setTab] = useState("dashboard");
  const tabs = [
    { key: "dashboard", label: "현황", icon: "📊" },
    { key: "reservations", label: "예약관리", icon: "📋" },
    { key: "holidays", label: "공휴일", icon: "📅" },
    { key: "notices", label: "공지", icon: "📢" },
  ];
  return (
    <div style={S.page}>
      <TopBar title={`관리자 · ${APP_NAME}`} user={user} onLogout={() => setUser(null)} admin />
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 70 }}>
        {tab === "dashboard" && <DashboardTab reservations={reservations} holidays={holidays} />}
        {tab === "reservations" && <AdminReservationsTab reservations={reservations} setReservations={setReservations} holidays={holidays} genId={genId} />}
        {tab === "holidays" && <HolidayTab holidays={holidays} setHolidays={setHolidays} />}
        {tab === "notices" && <AdminNoticesTab notices={notices} setNotices={setNotices} genId={genId} />}
      </div>
      <BottomNav tabs={tabs} active={tab} onChange={setTab} />
    </div>
  );
}

function DashboardTab({ reservations, holidays }) {
  const [selDate, setSelDate] = useState(today());
  const days = nextDays(14);
  const dayType = getDayType(selDate, holidays);
  const slots = getSlots(selDate, holidays);
  const activeRes = reservations.filter(r => r.date === selDate && !r.cancelled);
  const cancelledRes = reservations.filter(r => r.date === selDate && r.cancelled);

  return (
    <div style={S.section}>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, marginBottom: 16 }}>
        {days.map(d => {
          const dt = getDayType(d, holidays);
          return (
            <button key={d} onClick={() => setSelDate(d)} style={{ ...S.datePill, background: selDate === d ? "#E17055" : "#f0f0f0", color: selDate === d ? "#fff" : "#666" }}>
              <div style={{ fontSize: 10 }}>{new Date(d + "T00:00:00").toLocaleDateString("ko-KR", { weekday: "short" })}</div>
              <div style={{ fontSize: 15 }}>{new Date(d + "T00:00:00").getDate()}</div>
              {dt !== "weekday" && <div style={{ fontSize: 9, color: selDate === d ? "#ffeaa7" : dt === "holiday" ? "#C62828" : "#6A1B9A" }}>{dt === "holiday" ? "공휴" : "주말"}</div>}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <StatCard label="예약" value={activeRes.length} color="#00B894" />
        <StatCard label="입금대기" value={activeRes.filter(r => r.status === "pending").length} color="#E17055" />
        <StatCard label="취소" value={cancelledRes.length} color="#aaa" />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <h2 style={{ ...S.sectionTitle, margin: 0 }}>예약 현황표</h2>
        <span style={{ ...dayTypeBadgeStyle(dayType), fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{dayTypeLabel(dayType)}</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 300 }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              <th style={S.th}>시간대</th>
              {COURTS.map(c => <th key={c} style={{ ...S.th, color: COLORS[c] }}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, si) => (
              <tr key={slot} style={{ background: si % 2 === 0 ? "#fff" : "#fafafa" }}>
                <td style={{ ...S.td, fontSize: 11 }}>{slot}</td>
                {COURTS.map(court => {
                  const res = activeRes.find(r => r.court === court && r.slot === slot);
                  return (
                    <td key={court} style={{ ...S.td, background: res ? "#e8f5e9" : "transparent" }}>
                      {res
                        ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                          <span style={{ color: "#2e7d32", fontSize: 11 }}>{res.team}</span>
                          <span style={res.status === "confirmed" ? S.badgeConfirmed : S.badgePending}>{res.status === "confirmed" ? "확" : "예"}</span>
                        </div>
                        : <span style={{ color: "#ccc" }}>-</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 슬롯 시간 계산 헬퍼 ──────────────────────────────
function slotHours(slot) {
  try {
    const [s, e] = slot.split("~").map(t => parseInt(t.split(":")[0]));
    return e > s ? e - s : 24 - s + e;
  } catch { return 0; }
}
function slotFee(slot) {
  const h = slotHours(slot);
  if (h <= 0) return 0;
  return 80000 + Math.max(0, h - 2) * 40000;
}

function AdminReservationsTab({ reservations, setReservations, holidays, genId }) {
  const [viewMode, setViewMode] = useState("daily"); // daily | stats
  const [filter, setFilter] = useState(today());
  const [showAdd, setShowAdd] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [form, setForm] = useState({ date: today(), court: "A구장", slot: "", team: "", contact: "" });
  // 날짜 직접 입력 (과거 포함)
  const [manualDate, setManualDate] = useState(today());
  const [statsMonth, setStatsMonth] = useState(today().slice(0, 7));

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const slots = getSlots(form.date, holidays);
  const filtered = reservations.filter(r => r.date === filter);

  const confirmPayment = (id) => {
    setReservations(p => p.map(r => r.id === id ? { ...r, status: "confirmed" } : r));
    setSelectedId(null);
  };
  const approveCancel = (id) => {
    setReservations(p => p.map(r => r.id === id ? { ...r, cancelled: true, cancelRequested: false, status: "cancelled" } : r));
    setConfirmDeleteId(null); setSelectedId(null);
  };
  const deleteRes = (id) => {
    setReservations(p => p.filter(r => r.id !== id));
    setConfirmDeleteId(null); setSelectedId(null);
  };
  const add = () => {
    if (!form.team || !form.slot) return;
    const taken = reservations.some(r => r.date === form.date && r.court === form.court && r.slot === form.slot && !r.cancelled);
    if (taken) { alert("해당 슬롯은 이미 예약되어 있습니다."); return; }
    setReservations(p => [...p, { ...form, id: genId(), status: "pending", userId: "admin", cancelled: false, cancelRequested: false }]);
    setShowAdd(false);
    setForm({ date: today(), court: "A구장", slot: "", team: "", contact: "" });
  };

  // 월별 통계 계산
  const monthReservations = reservations.filter(r => r.date.startsWith(statsMonth));
  const confirmedMonth = monthReservations.filter(r => !r.cancelled);
  const cancelledMonth = monthReservations.filter(r => r.cancelled);
  const totalHours = confirmedMonth.reduce((s, r) => s + slotHours(r.slot), 0);
  const totalFee = confirmedMonth.reduce((s, r) => s + slotFee(r.slot), 0);
  const refundFee = cancelledMonth.filter(r => r.status === "confirmed" || r.paidBeforeCancel).reduce((s, r) => s + slotFee(r.slot), 0);

  // 최근 30일 + 과거 날짜 선택
  const futureDays = nextDays(30);
  // 과거 60일
  const pastDays = Array.from({ length: 60 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 60 + i);
    return d.toISOString().slice(0, 10);
  }).filter(d => d < today());

  const CancelConfirmModal = ({ res }) => (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 320, textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🗑️</div>
        <p style={{ color: S.textPrimary, fontWeight: 700, fontSize: 16, marginBottom: 6 }}>취소할까요?</p>
        <p style={{ color: S.textMuted, fontSize: 13, marginBottom: 20 }}>{res.team} · {res.court} · {res.slot}</p>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={() => setConfirmDeleteId(null)} style={{ flex: 1, background: "#f0f0f0", color: "#555" }}>아니요</Btn>
          <Btn onClick={() => approveCancel(res.id)} style={{ flex: 1, background: "#E17055" }}>확인</Btn>
        </div>
      </div>
    </div>
  );

  return (
    <div style={S.section}>
      {confirmDeleteId && (() => { const res = reservations.find(r => r.id === confirmDeleteId); return res ? <CancelConfirmModal res={res} /> : null; })()}

      {/* 탭 전환 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[{ k: "daily", l: "📋 일별 예약" }, { k: "stats", l: "📊 월별 통계" }].map(t => (
          <button key={t.k} onClick={() => setViewMode(t.k)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", background: viewMode === t.k ? "#E17055" : "#f0f0f0", color: viewMode === t.k ? "#fff" : "#666" }}>{t.l}</button>
        ))}
      </div>

      {/* ── 일별 예약 뷰 ── */}
      {viewMode === "daily" && <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ ...S.sectionTitle, margin: 0 }}>예약 관리</h2>
          <Btn onClick={() => setShowAdd(p => !p)} style={{ padding: "6px 12px", fontSize: 12 }}>+ 직접 등록</Btn>
        </div>

        {showAdd && (
          <div style={{ ...S.card, marginBottom: 16 }}>
            <h3 style={{ color: S.textPrimary, fontSize: 14, marginBottom: 12 }}>예약 직접 등록</h3>
            <Input label="날짜" value={form.date} onChange={v => f("date", v)} type="date" />
            <label style={{ color: S.textMuted, fontSize: 12 }}>구장</label>
            <select value={form.court} onChange={e => f("court", e.target.value)} style={{ ...S.select, marginTop: 4 }}>{COURTS.map(c => <option key={c}>{c}</option>)}</select>
            <label style={{ color: S.textMuted, fontSize: 12 }}>시간대</label>
            <select value={form.slot} onChange={e => f("slot", e.target.value)} style={{ ...S.select, marginTop: 4 }}>
              <option value="">-- 선택 --</option>
              {slots.map(s => <option key={s}>{s}</option>)}
            </select>
            <Input label="팀명" value={form.team} onChange={v => f("team", v)} placeholder="팀명" />
            <Input label="연락처" value={form.contact} onChange={v => f("contact", v)} placeholder="010-0000-0000" />
            <div style={{ display: "flex", gap: 8 }}>
              <Btn onClick={() => setShowAdd(false)} style={{ flex: 1, background: "#f0f0f0", color: "#555" }}>닫기</Btn>
              <Btn onClick={add} style={{ flex: 1, background: "#00B894" }}>등록</Btn>
            </div>
          </div>
        )}

        {/* 날짜 직접 입력 (과거 조회용) */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <input type="date" value={manualDate} onChange={e => { setManualDate(e.target.value); setFilter(e.target.value); }}
            style={{ ...S.input, flex: 1, padding: "8px 10px" }} />
          <Btn onClick={() => setFilter(manualDate)} style={{ padding: "8px 14px", fontSize: 12, whiteSpace: "nowrap" }}>조회</Btn>
        </div>

        {/* 날짜 바 — 미래 30일 */}
        <p style={{ color: S.textMuted, fontSize: 11, marginBottom: 6 }}>빠른 선택 (향후 30일)</p>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, marginBottom: 12 }}>
          {futureDays.map(d => {
            const dt = getDayType(d, holidays);
            return (
              <button key={d} onClick={() => { setFilter(d); setManualDate(d); }} style={{ ...S.datePill, background: filter === d ? "#E17055" : "#f0f0f0", color: filter === d ? "#fff" : "#666" }}>
                <div style={{ fontSize: 10 }}>{new Date(d + "T00:00:00").toLocaleDateString("ko-KR", { weekday: "short" })}</div>
                <div style={{ fontSize: 14 }}>{new Date(d + "T00:00:00").getDate()}</div>
                {dt !== "weekday" && <div style={{ fontSize: 9, color: filter === d ? "#ffeaa7" : dt === "holiday" ? "#C62828" : "#6A1B9A" }}>{dt === "holiday" ? "공휴" : "주말"}</div>}
              </button>
            );
          })}
        </div>

        <p style={{ color: S.textMuted, fontSize: 12, marginBottom: 8 }}>
          📅 {dateLabel(filter)} — 총 {filtered.length}건
        </p>
        {filtered.length === 0 && <Empty text="이 날짜에 예약이 없습니다" />}
        {filtered.map(r => (
          <div key={r.id}>
            <div onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
              style={{ ...S.card, marginBottom: selectedId === r.id ? 0 : 10, cursor: "pointer", opacity: r.cancelled ? 0.7 : 1, borderBottomLeftRadius: selectedId === r.id ? 0 : 14, borderBottomRightRadius: selectedId === r.id ? 0 : 14, borderBottom: selectedId === r.id ? "none" : undefined }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <CourtDot court={r.court} />
                    <span style={{ color: S.textPrimary, fontWeight: 700 }}>{r.team}</span>
                    {r.cancelled ? <span style={S.badgeCancelled}>취</span>
                      : r.cancelRequested ? <span style={S.badgeCancelReq}>취소요청</span>
                      : <span style={r.status === "confirmed" ? S.badgeConfirmed : S.badgePending}>{r.status === "confirmed" ? "확" : "예"}</span>}
                  </div>
                  <p style={{ color: "#777", fontSize: 12, marginTop: 4 }}>{r.court} · {r.slot}</p>
                  <p style={{ color: S.textMuted, fontSize: 11 }}>{r.contact}</p>
                </div>
                <span style={{ color: "#bbb", fontSize: 12 }}>{selectedId === r.id ? "▲" : "▼"}</span>
              </div>
            </div>
            {selectedId === r.id && (
              <div style={{ background: "#fafafa", border: "1px solid #eee", borderTop: "none", borderBottomLeftRadius: 14, borderBottomRightRadius: 14, padding: "12px 14px", marginBottom: 10 }}>
                {r.cancelled ? (<>
                  <p style={{ color: "#999", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>🚫 취소 완료된 예약입니다.</p>
                  <Btn onClick={() => deleteRes(r.id)} style={{ width: "100%", background: "#bbb", padding: "10px" }}>🗑️ 삭제</Btn>
                </>) : r.cancelRequested ? (<>
                  <p style={{ color: "#E17055", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>📩 예약자가 취소를 요청했습니다.</p>
                  <Btn onClick={() => setConfirmDeleteId(r.id)} style={{ width: "100%", background: "#E17055", padding: "10px" }}>취소 승인하기</Btn>
                </>) : r.status === "confirmed" ? (
                  <p style={{ color: "#2e7d32", fontSize: 13, fontWeight: 600 }}>✅ 입금 확인 완료</p>
                ) : (<>
                  <p style={{ color: "#E17055", fontSize: 12, marginBottom: 8 }}>💳 입금 확인 전입니다. 확인 후 아래 버튼을 눌러주세요.</p>
                  <Btn onClick={() => confirmPayment(r.id)} style={{ width: "100%", background: "#00B894", padding: "10px" }}>✅ 입금 확인</Btn>
                </>)}
              </div>
            )}
          </div>
        ))}
      </>}

      {/* ── 월별 통계 뷰 ── */}
      {viewMode === "stats" && <>
        <h2 style={S.sectionTitle}>월별 통계</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
          <input type="month" value={statsMonth} onChange={e => setStatsMonth(e.target.value)}
            style={{ ...S.input, flex: 1, padding: "8px 10px" }} />
        </div>

        {/* 요약 카드 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          {[
            { label: "예약팀수", value: `${confirmedMonth.length}팀`, color: "#00B894" },
            { label: "예약시간 합계", value: `${totalHours}시간`, color: "#6C63FF" },
            { label: "사용료 합계", value: `${(totalFee / 10000).toFixed(0)}만원`, color: "#E17055" },
            { label: "취소건수", value: `${cancelledMonth.length}건`, color: "#aaa" },
            { label: "환불금액 합계", value: `${(refundFee / 10000).toFixed(0)}만원`, color: "#F0A500" },
            { label: "입금대기", value: `${confirmedMonth.filter(r => r.status === "pending").length}건`, color: "#FF6584" },
          ].map(c => (
            <div key={c.label} style={{ ...S.card, textAlign: "center", padding: "14px 10px" }}>
              <p style={{ color: c.color, fontSize: 22, fontWeight: 700, margin: 0 }}>{c.value}</p>
              <p style={{ color: S.textMuted, fontSize: 11, marginTop: 4 }}>{c.label}</p>
            </div>
          ))}
        </div>

        {/* 구장별 상세 */}
        <h2 style={S.sectionTitle}>구장별 현황</h2>
        {COURTS.map(court => {
          const cRes = confirmedMonth.filter(r => r.court === court);
          const cCancel = cancelledMonth.filter(r => r.court === court);
          const cHours = cRes.reduce((s, r) => s + slotHours(r.slot), 0);
          const cFee = cRes.reduce((s, r) => s + slotFee(r.slot), 0);
          return (
            <div key={court} style={{ ...S.card, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: COLORS[court] }} />
                <span style={{ color: S.textPrimary, fontWeight: 700 }}>{court}</span>
              </div>
              <div style={{ display: "flex", gap: 0 }}>
                {[
                  { l: "예약", v: `${cRes.length}팀` },
                  { l: "시간", v: `${cHours}h` },
                  { l: "사용료", v: `${(cFee / 10000).toFixed(0)}만` },
                  { l: "취소", v: `${cCancel.length}건` },
                ].map((item, i) => (
                  <div key={i} style={{ flex: 1, textAlign: "center", borderRight: i < 3 ? "1px solid #f0f0f0" : "none" }}>
                    <p style={{ color: S.textPrimary, fontWeight: 700, fontSize: 15 }}>{item.v}</p>
                    <p style={{ color: S.textMuted, fontSize: 11 }}>{item.l}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* 예약 상세 목록 */}
        <h2 style={{ ...S.sectionTitle, marginTop: 8 }}>예약 상세 목록</h2>
        {monthReservations.length === 0 && <Empty text="이 달의 예약이 없습니다" />}
        {[...monthReservations].sort((a, b) => a.date.localeCompare(b.date)).map(r => (
          <div key={r.id} style={{ ...S.card, marginBottom: 8, opacity: r.cancelled ? 0.6 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <CourtDot court={r.court} />
                  <span style={{ color: S.textPrimary, fontWeight: 600, fontSize: 13 }}>{r.team}</span>
                  {r.cancelled ? <span style={S.badgeCancelled}>취</span>
                    : r.cancelRequested ? <span style={S.badgeCancelReq}>취소요청</span>
                    : <span style={r.status === "confirmed" ? S.badgeConfirmed : S.badgePending}>{r.status === "confirmed" ? "확" : "예"}</span>}
                </div>
                <p style={{ color: S.textMuted, fontSize: 11, marginTop: 3 }}>{dateLabel(r.date)} · {r.court} · {r.slot}</p>
              </div>
              <span style={{ color: r.cancelled ? "#aaa" : "#00B894", fontWeight: 700, fontSize: 13 }}>
                {r.cancelled ? "-" : `${(slotFee(r.slot) / 10000).toFixed(0)}만`}
              </span>
            </div>
          </div>
        ))}
      </>}
    </div>
  );
}

// ── 공휴일 관리 탭 ─────────────────────────────────────
function HolidayTab({ holidays, setHolidays }) {
  const [selDate, setSelDate] = useState(today());
  const days = nextDays(60);

  const isHoliday = (d) => holidays.includes(d);
  const toggle = (d) => {
    setHolidays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d].sort());
  };

  return (
    <div style={S.section}>
      <h2 style={S.sectionTitle}>공휴일 지정</h2>
      <p style={{ color: S.textMuted, fontSize: 13, marginBottom: 16 }}>
        공휴일로 지정하면 <b>10:00~24:00 / 1시간 단위</b> 예약이 적용됩니다.
      </p>

      {/* 달력형 날짜 선택 */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, marginBottom: 20 }}>
        {days.map(d => {
          const dt = new Date(d + "T00:00:00");
          const dow = dt.getDay();
          const isWknd = dow === 0 || dow === 6;
          const isHol = isHoliday(d);
          return (
            <button key={d} onClick={() => toggle(d)} style={{
              ...S.datePill, width: 50, height: 66, flexShrink: 0,
              background: isHol ? "#C62828" : isWknd ? "#f3e5f5" : "#f5f5f5",
              color: isHol ? "#fff" : isWknd ? "#6A1B9A" : "#555",
              border: `2px solid ${isHol ? "#C62828" : "transparent"}`,
              position: "relative",
            }}>
              <div style={{ fontSize: 10 }}>{dt.toLocaleDateString("ko-KR", { weekday: "short" })}</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{dt.getDate()}</div>
              <div style={{ fontSize: 9 }}>{dt.toLocaleDateString("ko-KR", { month: "numeric" })}월</div>
              {isHol && <div style={{ fontSize: 8, marginTop: 2 }}>공휴일</div>}
            </button>
          );
        })}
      </div>

      <h2 style={{ ...S.sectionTitle, marginTop: 8 }}>지정된 공휴일 목록</h2>
      {holidays.length === 0 && <Empty text="지정된 공휴일이 없습니다" />}
      {holidays.map(d => (
        <div key={d} style={{ ...S.card, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ color: S.textPrimary, fontWeight: 600 }}>{dateLabel(d)}</span>
            <span style={{ marginLeft: 8, fontSize: 11, padding: "2px 7px", borderRadius: 10, background: "#fce4ec", color: "#C62828", fontWeight: 600 }}>공휴일</span>
          </div>
          <button onClick={() => toggle(d)} style={{ color: "#E17055", fontSize: 12, background: "none", border: "none", cursor: "pointer" }}>해제</button>
        </div>
      ))}
    </div>
  );
}

function AdminNoticesTab({ notices, setNotices, genId }) {
  const [form, setForm] = useState({ title: "", content: "" });
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const add = () => {
    if (!form.title || !form.content) return;
    setNotices(p => [...p, { id: genId(), ...form, date: today() }]);
    setForm({ title: "", content: "" });
  };
  return (
    <div style={S.section}>
      <h2 style={S.sectionTitle}>공지사항 등록</h2>
      <div style={{ ...S.card, marginBottom: 16 }}>
        <Input label="제목" value={form.title} onChange={v => f("title", v)} placeholder="공지 제목" />
        <label style={{ color: S.textMuted, fontSize: 12 }}>내용</label>
        <textarea value={form.content} onChange={e => f("content", e.target.value)} placeholder="공지 내용" style={{ ...S.input, height: 80, resize: "none", marginTop: 4 }} />
        <Btn onClick={add} style={{ width: "100%", marginTop: 8 }} disabled={!form.title || !form.content}>등록</Btn>
      </div>
      <h2 style={S.sectionTitle}>공지 목록</h2>
      {notices.length === 0 && <Empty text="등록된 공지가 없습니다" />}
      {[...notices].reverse().map(n => (
        <div key={n.id} style={{ ...S.card, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <p style={{ color: S.textPrimary, fontWeight: 600 }}>{n.title}</p>
              <p style={{ color: S.textMuted, fontSize: 12, marginTop: 4 }}>{n.content}</p>
              <p style={{ color: "#bbb", fontSize: 11, marginTop: 6 }}>{n.date}</p>
            </div>
            <button onClick={() => setNotices(p => p.filter(x => x.id !== n.id))} style={{ color: "#E17055", fontSize: 12, background: "none", border: "none", cursor: "pointer" }}>삭제</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// 공용 컴포넌트
// ══════════════════════════════════════════════════════
function TopBar({ title, user, onLogout, admin }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "#fff", borderBottom: "1px solid #eee", flexShrink: 0, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
      <div>
        <span style={{ color: S.textPrimary, fontWeight: 700, fontSize: 16 }}>{title}</span>
        {admin && <span style={{ marginLeft: 8, fontSize: 11, padding: "2px 7px", background: "#fdecea", color: "#E17055", borderRadius: 10 }}>관리자</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: S.textMuted, fontSize: 12 }}>{user.role === "admin" ? user.name : user.id}</span>
        <button onClick={onLogout} style={{ color: "#aaa", fontSize: 12, background: "none", border: "none", cursor: "pointer" }}>로그아웃</button>
      </div>
    </div>
  );
}

function BottomNav({ tabs, active, onChange }) {
  return (
    <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, display: "flex", background: "#fff", borderTop: "1px solid #eee", zIndex: 100, boxShadow: "0 -2px 8px rgba(0,0,0,0.06)" }}>
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)} style={{ flex: 1, padding: "10px 0", background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <span style={{ fontSize: 20 }}>{t.icon}</span>
          <span style={{ fontSize: 10, color: active === t.key ? "#00B894" : "#bbb", fontWeight: active === t.key ? 700 : 400 }}>{t.label}</span>
          {active === t.key && <div style={{ width: 20, height: 2, background: "#00B894", borderRadius: 2 }} />}
        </button>
      ))}
    </div>
  );
}

function NoticeBar({ notices }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (notices.length <= 1) return;
    const t = setInterval(() => setIdx(p => (p + 1) % notices.length), 3000);
    return () => clearInterval(t);
  }, [notices.length]);
  if (notices.length === 0) return null;
  return (
    <div style={{ background: "#fff8e1", borderRadius: 10, padding: "8px 12px", marginBottom: 16, display: "flex", gap: 8, alignItems: "center", border: "1px solid #ffe082" }}>
      <span style={{ fontSize: 11, padding: "2px 6px", background: "#F0A500", color: "#fff", borderRadius: 6, flexShrink: 0 }}>공지</span>
      <span style={{ color: "#555", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{notices[idx]?.title}</span>
    </div>
  );
}

function BackHeader({ title, onBack }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
      <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#888" }}>←</button>
      <h2 style={{ color: S.textPrimary, fontSize: 18, margin: 0 }}>{title}</h2>
    </div>
  );
}

function StepIndicator({ current, total, labels }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", flex: i < total - 1 ? 1 : 0 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: i + 1 <= current ? "#00B894" : "#f0f0f0", color: i + 1 <= current ? "#fff" : "#bbb" }}>{i + 1}</div>
            <span style={{ fontSize: 10, color: i + 1 === current ? "#00B894" : "#bbb", marginTop: 4, whiteSpace: "nowrap" }}>{labels[i]}</span>
          </div>
          {i < total - 1 && <div style={{ flex: 1, height: 2, background: i + 1 < current ? "#00B894" : "#eee", margin: "0 6px", marginBottom: 16 }} />}
        </div>
      ))}
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = "text", onEnter }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={{ color: S.textMuted, fontSize: 12, display: "block", marginBottom: 4 }}>{label}</label>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} onKeyDown={e => onEnter && e.key === "Enter" && onEnter()} placeholder={placeholder} style={S.input} />
    </div>
  );
}

function Btn({ children, onClick, style = {}, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ padding: "12px 20px", borderRadius: 12, border: "none", background: "#00B894", color: "#fff", fontWeight: 700, fontSize: 14, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, ...style }}>
      {children}
    </button>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f0f0f0" }}>
      <span style={{ color: S.textMuted, fontSize: 13 }}>{label}</span>
      <span style={{ color: S.textPrimary, fontSize: 13, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ flex: 1, background: "#fff", borderRadius: 12, padding: "12px", textAlign: "center", border: "1px solid #eee", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
      <p style={{ color, fontSize: 24, fontWeight: 700, margin: 0 }}>{value}</p>
      <p style={{ color: S.textMuted, fontSize: 11, marginTop: 4 }}>{label}</p>
    </div>
  );
}

function CourtDot({ court }) {
  return <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[court], flexShrink: 0 }} />;
}

function Empty({ text }) {
  return <div style={{ textAlign: "center", padding: "32px 0", color: "#ccc", fontSize: 13 }}>{text}</div>;
}

const S = {
  page: { minHeight: "100vh", background: "#f7f8fa", display: "flex", flexDirection: "column", maxWidth: 480, margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  section: { padding: "16px 16px 8px" },
  sectionTitle: { color: "#222", fontSize: 15, fontWeight: 700, margin: "0 0 12px" },
  card: { background: "#fff", borderRadius: 14, padding: "14px", border: "1px solid #eee", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" },
  datePill: { flexShrink: 0, width: 46, padding: "8px 0", borderRadius: 12, border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 },
  courtBtn: { padding: "12px 20px", borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: "pointer" },
  input: { width: "100%", padding: "11px 12px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fafafa", color: "#222", fontSize: 14, boxSizing: "border-box" },
  select: { width: "100%", padding: "11px 12px", borderRadius: 10, border: "1px solid #e0e0e0", background: "#fafafa", color: "#222", fontSize: 14, marginBottom: 10 },
  th: { padding: "8px 6px", fontSize: 11, color: "#888", textAlign: "center", borderBottom: "1px solid #eee" },
  td: { padding: "6px 4px", fontSize: 11, textAlign: "center", borderBottom: "1px solid #f5f5f5" },
  linkBtn: { background: "none", border: "none", cursor: "pointer", color: "#00B894", fontSize: 12, fontWeight: 600, textDecoration: "underline", padding: 0 },
  badgePending: { fontSize: 10, padding: "1px 5px", borderRadius: 6, background: "#fff3e0", color: "#E17055", fontWeight: 700, border: "1px solid #ffcc80" },
  badgeConfirmed: { fontSize: 10, padding: "1px 5px", borderRadius: 6, background: "#e8f5e9", color: "#2e7d32", fontWeight: 700, border: "1px solid #a5d6a7" },
  badgeCancelReq: { fontSize: 10, padding: "1px 5px", borderRadius: 6, background: "#fce4ec", color: "#C62828", fontWeight: 700, border: "1px solid #ef9a9a" },
  textPrimary: "#222",
  textMuted: "#888",
};
