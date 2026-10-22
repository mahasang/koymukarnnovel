import { useEffect, useState } from "react";
import Library from "./pages/Library";
import Novel from "./pages/Novel";
import Reader from "./pages/Reader";

type Route = { page: "library" } | { page: "novel"; id: number } | { page: "chapter"; id: number };

function parse(hash: string): Route {
  const m = hash.match(/^#\/(novel|chapter)\/(\d+)/);
  if (m) return { page: m[1] as "novel" | "chapter", id: Number(m[2]) };
  return { page: "library" };
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  switch (route.page) {
    case "novel":
      return <Novel key={route.id} id={route.id} />;
    case "chapter":
      return <Reader key={route.id} id={route.id} />;
    default:
      return <Library />;
  }
}
