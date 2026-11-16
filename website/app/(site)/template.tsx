import { Reveal } from "@/components/home/Reveal";

// Remounts on every page change: the page fades in, and sections marked
// data-reveal slide in as they scroll into view.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-in">
      <Reveal />
      {children}
    </div>
  );
}
