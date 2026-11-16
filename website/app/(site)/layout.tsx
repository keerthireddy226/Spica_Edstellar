import { Header } from "@/components/Header";
import "./home.css";
import { CtaBand } from "@/components/page/CtaBand";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site">
      <Header />
      {children}
      <CtaBand />
    </div>
  );
}
