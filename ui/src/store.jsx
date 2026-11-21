import React, { createContext, useContext, useReducer } from 'react';

const initialState = {
  session: { logged_in: false, authenticated: false, patients: [] },
  config: { queryConnections: 7, bookingParallel: 16, refreshInterval: 60, autoRefresh: false, jitterSeconds: 15 },
  hospitals: [],
  departments: [],
  selectedHospital: null,
  selectedDepartment: null,
  selectedDates: [],
  rows: [],
  stale: false,
  selectedRow: null,
  preview: null
};

function reducer(state, action) {
  switch (action.type) {
    case 'session': return { ...state, session: action.value };
    case 'config': return { ...state, config: { ...state.config, ...action.value } };
    case 'hospitals': return { ...state, hospitals: action.value };
    case 'departments': return { ...state, departments: action.value, selectedDepartment: null };
    case 'hospital': return { ...state, selectedHospital: action.value, departments: [], selectedDepartment: null };
    case 'department': return { ...state, selectedDepartment: action.value };
    case 'dates': return { ...state, selectedDates: action.value };
    case 'rows': return { ...state, rows: action.value, stale: false };
    case 'stale': return { ...state, stale: true };
    case 'selectedRow': return { ...state, selectedRow: action.value, preview: null };
    case 'preview': return { ...state, preview: action.value };
    default: return state;
  }
}

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}
