import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AdminDashboard } from './pages/AdminDashboard';
import { MissionRegistration } from './pages/MissionRegistration';

function App() {
  return (
    <Routes>
      <Route path="/m/:code" element={<MissionRegistration />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

export default App;
