import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Landing } from "./pages/Landing.tsx";
import { Past } from "./pages/Past.tsx";
import { Admin } from "./pages/Admin.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { FindTeam } from "./pages/FindTeam.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/past" element={<Past />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/find-team" element={<FindTeam />} />
        {/* /claim is the order-reference flow; the dashboard surfaces it inline. */}
        <Route path="/claim" element={<Dashboard />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
