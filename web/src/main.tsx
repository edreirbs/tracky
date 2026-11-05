import "@fontsource/manrope/400.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "@fontsource/caveat/700.css";
import { render } from "preact";
import { App } from "./ui/App.js";
import "./ui/styles.css";

render(<App />, document.getElementById("app")!);
