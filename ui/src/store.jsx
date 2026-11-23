import React, { createContext, useContext, useReducer, useEffect } from 'react';

const PERSIST_KEY = 'assisted-registration-ui-v1';

const defaults = {
  // Session is intentionally NOT persisted here: it lives in the OS Keychain/DPAPI.
  session: { logged_in: false, authenticated: false, patients: [] },
  config: { queryConnections: 7, bookingParallel: 16, refreshInterval: 60, autoRefresh: false, jitterSeconds: 15, notifyOnResults: false, alarmTimes: 3 },
  hospitals: [],
  departments: [],
  selectedHospital: null,
  selectedDepartment: null,
  selectedDates: [],
  rows: [],
  stale: false,
  selectedRow: null,
  preview: null,
  filters: {},        // per-column result filters, persisted
  catalogSearch: ''   // hospital search text, persisted
};

function loadPersisted() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function makeInitial() {
  const p = loadPersisted();
  return {
    ...defaults,
    config: { ...defaults.config, ...(p.config || {}) },
    selectedHospital: p.selectedHospital ?? null,
    selectedDepartment: p.selectedDepartment ?? null,
    selectedDates: Array.isArray(p.selectedDates) ? p.selectedDates : [],
    filters: p.filters && typeof p.filters === 'object' ? p.filters : {},
    catalogSearch: typeof p.catalogSearch === 'string' ? p.catalogSearch : ''
  };
}

function reducer(state, action) {
  switch (action.type) {
    case 'session': return { ...state, session: action.value };
    case 'config': return { ...state, config: { ...state.config, ...action.value } };
    case 'hospitals': return { ...state, hospitals: action.value };
    case 'departments': {
      // Keep the persisted department selection if it still exists in the new list.
      const keep = state.selectedDepartment && action.value.some((d) => d.code === state.selectedDepartment);
      return { ...state, departments: action.value, selectedDepartment: keep ? state.selectedDepartment : null };
    }
    case 'hospital': return { ...state, selectedHospital: action.value, departments: [], selectedDepartment: null };
    case 'department': return { ...state, selectedDepartment: action.value };
    case 'dates': return { ...state, selectedDates: action.value };
    case 'rows': return { ...state, rows: action.value, stale: false };
    case 'stale': return { ...state, stale: true };
    case 'selectedRow': return { ...state, selectedRow: action.value, preview: null };
    case 'preview': return { ...state, preview: action.value };
    case 'filter': {
      const prev = state.filters[action.key] || { text: '', regex: false };
      return { ...state, filters: { ...state.filters, [action.key]: { ...prev, ...action.patch } } };
    }
    case 'clearFilters': return { ...state, filters: {} };
    case 'catalogSearch': return { ...state, catalogSearch: action.value };
    default: return state;
  }
}

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, makeInitial);
  // Persist only UI preferences & context (never session cookies or live rows).
  useEffect(() => {
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify({
        config: state.config,
        selectedHospital: state.selectedHospital,
        selectedDepartment: state.selectedDepartment,
        selectedDates: state.selectedDates,
        filters: state.filters,
        catalogSearch: state.catalogSearch
      }));
    } catch { /* storage disabled / quota: non-fatal */ }
  }, [state.config, state.selectedHospital, state.selectedDepartment, state.selectedDates, state.filters, state.catalogSearch]);
  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}
