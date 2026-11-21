import React, { useState } from 'react';
import LoginPage from './LoginPage.jsx';
import CatalogPage from './CatalogPage.jsx';
import QueryPage from './QueryPage.jsx';
import BookingPage from './BookingPage.jsx';
import SettingsPage from './SettingsPage.jsx';
import { StoreProvider, useStore } from './store.jsx';
import { isElectron } from './rpc.js';

const NAV = [
  { key: 'login', label: '账号登录' },
  { key: 'catalog', label: '医院与科室' },
  { key: 'query', label: '号源查询' },
  { key: 'booking', label: '挂号' },
  { key: 'settings', label: '设置' }
];

function Shell() {
  const initial = (typeof location !== 'undefined' && location.hash.replace('#', '')) || 'login';
  const [page, setPage] = useState(NAV.some((n) => n.key === initial) ? initial : 'login');
  const { state } = useStore();
  return (
    <div className="app">
      <div className="topbar">
        <div className="logo" />
        <div>
          <div className="title">辅助挂号软件</div>
          <div className="subtitle">Web UI 原型 · {isElectron() ? 'Electron' : '浏览器演示'}</div>
        </div>
        <span className={`badge ${state.session.logged_in ? 'on' : ''}`} style={{ marginLeft: 'auto' }}>
          {state.session.logged_in ? '已登录' : '未登录'}
        </span>
      </div>
      <div className="layout">
        <nav className="sidebar">
          {NAV.map((item) => (
            <button key={item.key} className={`nav-item ${page === item.key ? 'active' : ''}`}
              onClick={() => setPage(item.key)}>
              {item.label}
            </button>
          ))}
        </nav>
        <main className="main">
          <div className="disclaimer">
            <b>免责协议</b>
            本软件为非官方辅助工具，供用户本人查询号源并在人工确认后提交一次预约，不保证号源可用或挂号成功。
            验证码须由本人输入，遇到提交结果未知时请先核对官方订单，勿重复提交。
          </div>
          {page === 'login' && <LoginPage />}
          {page === 'catalog' && <CatalogPage onQuery={() => setPage('query')} />}
          {page === 'query' && <QueryPage />}
          {page === 'booking' && <BookingPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return <StoreProvider><Shell /></StoreProvider>;
}
