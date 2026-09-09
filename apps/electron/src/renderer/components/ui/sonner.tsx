import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useTheme } from "@/context/ThemeContext"

// Empty fragment to hide all toast icons
const NoIcon = () => <></>

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedMode } = useTheme()

  return (
    <Sonner
      theme={resolvedMode as ToasterProps["theme"]}
      position="top-right"
      closeButton
      richColors={false}
      swipeDirections={["right"]}
      className="toaster group"
      icons={{
        success: <NoIcon />,
        info: <NoIcon />,
        warning: <NoIcon />,
        error: <NoIcon />,
        loading: <NoIcon />,
      }}
      toastOptions={{
        className: "craft-toast group",
      }}
      style={
        {
          "--normal-bg": "var(--popover-solid, var(--background))",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
