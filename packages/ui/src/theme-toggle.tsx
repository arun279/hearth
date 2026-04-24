import { Moon, Sun } from "lucide-react";
import { IconButton } from "./icon-button.tsx";
import { type Theme, useTheme } from "./theme.ts";

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <IconButton label={`Switch to ${next} theme`} onClick={() => setTheme(next)}>
      {theme === "dark" ? (
        <Sun size={14} strokeWidth={1.5} />
      ) : (
        <Moon size={14} strokeWidth={1.5} />
      )}
    </IconButton>
  );
}
