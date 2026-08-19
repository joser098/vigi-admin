import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Orders from "@/pages/Orders";
import OrderDetail from "@/pages/OrderDetail";
import Products from "@/pages/Products";
import ProductDetail from "@/pages/ProductDetail";
import Coupons from "@/pages/Coupons";
import CouponDetail from "@/pages/CouponDetail";

// El panel entero está detrás del guard. No hay ruta que se pueda alcanzar sin
// sesión y sin estar en la whitelist — y aunque se pudiera, RLS no devolvería
// ni una fila.
const Guard = () => {
  const { estado } = useAuth();

  if (estado === "cargando") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-neutral-400">Cargando…</p>
      </div>
    );
  }

  if (estado !== "listo") return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="ordenes" element={<Orders />} />
        <Route path="ordenes/:id" element={<OrderDetail />} />
        <Route path="productos" element={<Products />} />
        <Route path="productos/:id" element={<ProductDetail />} />
        <Route path="cupones" element={<Coupons />} />
        {/* "nuevo" entra por el mismo detalle: es el mismo formulario
            con y sin fila detrás. */}
        <Route path="cupones/:id" element={<CouponDetail />} />
        <Route path="*" element={<Dashboard />} />
      </Route>
    </Routes>
  );
};

const App = () => (
  <AuthProvider>
    <BrowserRouter>
      <Guard />
    </BrowserRouter>
  </AuthProvider>
);

export default App;
