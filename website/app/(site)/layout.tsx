import { Header } from "@/components/Header";

// Every page except Home: Home uses the design's own header inside its hero.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site">
      <Header />
      {children}
    </div>
  );
}
