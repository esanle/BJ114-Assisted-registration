import React from 'react';
import { useStore } from './store.jsx';

export default function SettingsPage() {
  const { state, dispatch } = useStore();
  const set = (key, value) => dispatch({ type: 'config', value: { [key]: value } });
  return (
    <div className="card">
      <h2>设置</h2>
      <p className="hint">查询连接数与挂号并发相互独立。并发数量不是成功率或网络吞吐量保证。</p>
      <div className="field">
        <label>查询连接数</label>
        <input type="number" min={1} max={16} value={state.config.queryConnections}
          onChange={(e) => set('queryConnections', Math.max(1, Math.min(16, Number(e.target.value))))} />
        <span className="badge">1–16</span>
      </div>
      <div className="field">
        <label>挂号并发</label>
        <input type="number" min={1} max={16} value={state.config.bookingParallel}
          onChange={(e) => set('bookingParallel', Math.max(1, Math.min(16, Number(e.target.value))))} />
        <span className="badge">1–16</span>
      </div>
      <div className="field">
        <label>刷新间隔（秒）</label>
        <input type="number" min={5} max={3600} value={state.config.refreshInterval}
          onChange={(e) => set('refreshInterval', Math.max(5, Number(e.target.value)))} />
      </div>
      <div className="field">
        <label>自动刷新</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={!!state.config.autoRefresh}
            onChange={(e) => set('autoRefresh', e.target.checked)} />
          查询成功后按间隔自动刷新下一次
        </label>
      </div>
      <div className="field">
        <label>随机抖动（秒）</label>
        <input type="number" min={0} max={120} value={state.config.jitterSeconds}
          onChange={(e) => set('jitterSeconds', Math.max(0, Math.min(120, Number(e.target.value))))} />
        <span className="badge">实际间隔 = 刷新间隔 + 0~抖动</span>
      </div>
      <div className="notice info">
        开启自动刷新后，每次成功查询会在「刷新间隔 + 随机几秒」后才发起下一次（默认 60 秒 + 0~15 秒），
        用随机抖动打散固定节奏，降低被限流的概率。失败、停止或切换条件会立即取消定时任务，不自动重发失败请求。
      </div>
      <div className="notice info" style={{ marginTop: 8 }}>配置已在本机保存（原型阶段仅内存态）；重启后恢复默认值。</div>
    </div>
  );
}
