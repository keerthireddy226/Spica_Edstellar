import type { Metadata } from "next";
import { HomeDesign } from "@/components/HomeDesign";
import "./home.css";

export const metadata: Metadata = {
  title: { absolute: "Spica by Edstellar | Know Your English Level and Prove It" },
  description:
    "Learn, practise and certify English in all four skills. CEFR levels A1 to C2, Spica scores from 10 to 90, proctored tests and certificates anyone can check online.",
};

export default function Home() {
  return <HomeDesign />;
}
