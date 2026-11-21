import React, { useEffect, useState } from 'react';
import { rpcCall, isElectron } from './rpc.js';
import { useStore } from './store.jsx';

export default function LoginPage() {
  const { state, dispatch } = useStore();
  const session = state.session;
  const setSession = (value) => dispatch({ type: 'session', value });
  const [phone, setPhone] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [image, setImage] = useState(null);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ type: 'info', text: isElectron() ? '正在加载本机会话…' : '演示模式：使用合成数据走通登录流程。' });
  const [countdown, setCountdown] = useState(0);

  const phoneOk = /^1[3-9]\d{9}$/.test(phone.trim());
  const captchaOk = /^\d{4}$/.test(captcha.trim());
  const smsOk = /^\d{6}$/.test(smsCode.trim());
  const loggedIn = session?.logged_in;

  useEffect(() => {
    let timer;
    if (countdown > 0) timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Try restoring a saved session once on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      setBusy(true);
      try {
        const r = await rpcCall('booking_restore', {});
        if (!active) return;
        if (r.ok && r.logged_in) {
          setSession({ logged_in: true, authenticated: !!r.authenticated, patients: r.patients || [] });
          setNotice({ type: 'ok', text: '已恢复本机保存的会话并通过官方校验。' });
        } else {
          setNotice({ type: 'info', text: '没有可恢复的会话，请手动登录。' });
        }
      } catch (e) {
        if (active) setNotice({ type: 'err', text: `会话恢复失败：${e.message}` });
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => { active = false; };
  }, [dispatch]);

  const run = async (op, params, onSuccess) => {
    setBusy(true);
    setNotice({ type: 'info', text: '处理中…' });
    try {
      const r = await rpcCall(op, params);
      if (r.ok || r.status === 'complete') {
        if (r.captcha_b64) setImage(`data:image/png;base64,${r.captcha_b64}`);
        if (r.retry_after_seconds) setCountdown(r.retry_after_seconds);
        onSuccess?.(r);
        setNotice({ type: 'ok', text: r.message || `${op} 成功` });
      } else {
        setNotice({ type: 'err', text: r.message || r.failure || `${op} 失败` });
      }
    } catch (e) {
      setNotice({ type: 'err', text: `请求失败：${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  const getCaptcha = () => run('booking_captcha', {}, () => { setCaptcha(''); setImage(null); });
  const sendSms = () => run('booking_sms', { phone: phone.trim(), captcha: captcha.trim() });
  const login = () => {
    if (!terms) { setNotice({ type: 'err', text: '请先阅读并同意官方用户协议和隐私政策。' }); return; }
    run('booking_login', { phone: phone.trim(), sms_code: smsCode.trim() }, (r) => {
      setSession({ logged_in: true, authenticated: !!r.authenticated, patients: [] });
    });
  };
  const logout = () => run('booking_logout', {}, () => {
    setSession({ logged_in: false, authenticated: false, patients: [] });
    setImage(null); setCaptcha(''); setSmsCode('');
  });
  const loadPatients = () => run('booking_patients', {}, (r) => {
    setSession({ ...state.session, patients: r.patients || [] });
  });

  return (
    <div className="card">
      <h2>官方账号登录</h2>
      <p className="hint">验证码须由本人输入；登录会话经本机安全存储加密保存，下次启动尝试恢复。</p>

      {loggedIn ? (
        <>
          <div className="notice ok">
            已登录{session.authenticated ? '（实名认证已通过）' : '（请先在官方平台完成实名认证）'}
            <span className="badge on" style={{ marginLeft: 8 }}>在线</span>
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={loadPatients} disabled={busy}>刷新就诊人</button>
            {' '}<button className="btn" onClick={logout} disabled={busy}>退出登录</button>
          </div>
          {session.patients?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <b>就诊人（脱敏）</b>
              <ul>
                {session.patients.map((p) => (
                  <li key={p.patient_id}>{p.name} — {p.cards?.map((c) => c.label).join('、')}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="field">
            <label>手机号</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={11} placeholder="11 位手机号" />
          </div>
          <div className="field">
            <label>图形验证码</label>
            <div className="captcha-row">
              <input value={captcha} onChange={(e) => setCaptcha(e.target.value)} maxLength={4} placeholder="4 位数字" style={{ flex: 'none', width: 120 }} />
              {image
                ? <img className="captcha-img" src={image} alt="验证码" />
                : <div className="captcha-img">先获取图形码</div>}
              <button className="btn" onClick={getCaptcha} disabled={busy}>获取 / 刷新图形码</button>
            </div>
          </div>
          <div className="field">
            <label>短信验证码</label>
            <input value={smsCode} onChange={(e) => setSmsCode(e.target.value)} maxLength={6} placeholder="6 位数字" />
            <button className="btn" onClick={sendSms} disabled={busy || !terms || !phoneOk || !captchaOk || countdown > 0}>
              {countdown > 0 ? `${countdown} 秒后可重发` : '发送短信验证码'}
            </button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            我已阅读并同意官方用户协议和隐私政策
          </label>
          <div className="actions">
            <button className="btn primary" onClick={login} disabled={busy || !terms || !phoneOk || !smsOk}>登录</button>
          </div>
        </>
      )}

      {notice.text && <div className={`notice ${notice.type}`}>{notice.text}</div>}
    </div>
  );
}
