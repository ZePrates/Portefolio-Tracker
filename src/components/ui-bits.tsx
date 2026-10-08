import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useId,
  useState,
} from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleAlert,
  Loader2,
  Minus,
  RefreshCw,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Componentes base do design system (ver README, secção "Design system").
 * Só usam tokens semânticos de `styles.css`: para mudar o aspeto altera-se
 * o tema, não cada componente.
 */

/* ------------------------------------------------------------------ */
/* Estrutura                                                           */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title,
  subtitle,
  meta,
  actions,
}: {
  title: string;
  subtitle?: string;
  /** Texto discreto ao lado do título (ex.: a data de hoje). */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] md:text-[28px]">{title}</h1>
          {meta && <span className="text-[13px] text-muted-foreground">{meta}</span>}
        </div>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Painel com título opcional. `min-w-0` evita que o conteúdo alargue as grelhas. */
export function Card({
  title,
  description,
  icon,
  action,
  children,
  className,
  headingLevel = 2,
}: {
  title?: string | undefined;
  description?: string | undefined;
  icon?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string | undefined;
  /** Nível do título: 3 quando o cartão está dentro de uma secção com <h2>. */
  headingLevel?: 2 | 3;
}) {
  const titleId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={cn("min-w-0 rounded-xl border border-border bg-card p-4 md:p-5", className)}
    >
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {icon}
            {title && (
              <Heading id={titleId} className="truncate text-[15px] font-semibold">
                {title}
              </Heading>
            )}
          </div>
          {action && <div className="shrink-0 text-xs">{action}</div>}
        </header>
      )}
      {description && <p className="-mt-2 mb-4 text-xs text-muted-foreground">{description}</p>}
      {children}
    </section>
  );
}

type Tone = "positive" | "negative" | "default";

const TONE_TEXT: Record<Tone, string> = {
  positive: "text-success",
  negative: "text-destructive",
  default: "text-muted-foreground",
};

/** Variação com sinal, seta e texto para leitores de ecrã: nunca depende só da cor. */
export function Delta({
  value,
  children,
  className,
}: {
  value: number;
  children: ReactNode;
  className?: string;
}) {
  const tone: Tone = value > 0 ? "positive" : value < 0 ? "negative" : "default";
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return (
    <span
      className={cn("num inline-flex items-center gap-0.5 font-medium", TONE_TEXT[tone], className)}
    >
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="sr-only">{value > 0 ? "Subida de " : value < 0 ? "Descida de " : ""}</span>
      {children}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  sub,
  tone,
  loading,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("min-w-0 rounded-xl border border-border bg-card p-4 md:p-5", className)}
      aria-busy={loading || undefined}
    >
      <p className="text-[12.5px] font-medium text-muted-foreground">{label}</p>
      {loading ? (
        <>
          <Skeleton className="mt-3 h-7 w-3/4" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </>
      ) : (
        <>
          <p
            className={cn(
              "num mt-2 break-words text-xl font-bold md:text-2xl",
              tone === "positive" && "text-success",
              tone === "negative" && "text-destructive",
            )}
          >
            {value}
          </p>
          {sub && (
            <p className={cn("num mt-1 text-xs", TONE_TEXT[tone ?? "default"])}>
              {tone === "positive" && (
                <ArrowUpRight aria-hidden className="mr-0.5 inline h-3 w-3" />
              )}
              {tone === "negative" && (
                <ArrowDownRight aria-hidden className="mr-0.5 inline h-3 w-3" />
              )}
              {sub}
            </p>
          )}
        </>
      )}
    </div>
  );
}

type BadgeTone = "neutral" | "gain" | "loss" | "warn" | "info" | "primary";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  gain: "bg-success/15 text-success",
  loss: "bg-destructive/15 text-destructive",
  warn: "bg-warning/15 text-warning",
  info: "bg-info/15 text-info",
  primary: "bg-primary/15 text-primary",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-medium",
        BADGE_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Estados: vazio, erro, carregamento                                  */
/* ------------------------------------------------------------------ */

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
        {icon ?? <Wallet aria-hidden className="h-6 w-6 text-muted-foreground" />}
      </div>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Não foi possível carregar os dados",
  description = "Verifica a ligação e tenta outra vez. Os teus dados não foram alterados.",
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-destructive/40 bg-destructive/5 px-6 py-10 text-center",
        className,
      )}
    >
      <CircleAlert aria-hidden className="h-6 w-6 text-destructive" />
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw aria-hidden className="h-3.5 w-3.5" />
          Tentar de novo
        </Button>
      )}
    </div>
  );
}

/** Esqueleto de uma linha de KPIs enquanto carrega. */
export function KpiGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4"
      aria-busy="true"
      aria-label="A carregar"
    >
      {Array.from({ length: count }, (_, i) => (
        <MetricCard key={i} label="" value="" loading />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Controlos                                                           */
/* ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "outline" | "ghost" | "danger" | "destructive";
type ButtonSize = "sm" | "md";

export function Button({
  variant = "primary",
  size = "md",
  loading,
  disabled,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Mostra um indicador e bloqueia cliques repetidos. */
  loading?: boolean;
}) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "min-h-10 px-4 py-2 text-sm sm:min-h-9" : "min-h-9 px-3 py-1.5 text-xs",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "outline" &&
          "border border-input bg-transparent text-foreground hover:bg-accent",
        variant === "ghost" && "text-muted-foreground hover:bg-accent hover:text-foreground",
        variant === "danger" && "bg-destructive/15 text-destructive hover:bg-destructive/25",
        variant === "destructive" &&
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        className,
      )}
      {...props}
    >
      {loading && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

/** Botão só com ícone: o rótulo é obrigatório (leitores de ecrã e tooltip). */
export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-9",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

const CONTROL_BASE =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/20 sm:text-sm";

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL_BASE, className)} {...props} />;
}

export function SelectInput({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROL_BASE, className)} {...props} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL_BASE, "min-h-20", className)} {...props} />;
}

const NATIVE_CONTROLS = new Set(["input", "select", "textarea"]);

/**
 * Rótulo + controlo + ajuda/erro. O erro aparece junto ao campo, é anunciado
 * (`role="alert"`) e liga-se ao controlo por `aria-invalid`/`aria-describedby`.
 */
export function Field({
  label,
  children,
  hint,
  error,
  required,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: string | undefined;
  error?: string | null | undefined;
  required?: boolean | undefined;
  className?: string | undefined;
}) {
  const messageId = useId();
  const message = error || hint;
  const describable =
    isValidElement(children) &&
    (typeof children.type === "string"
      ? NATIVE_CONTROLS.has(children.type)
      : children.type === TextInput || children.type === SelectInput || children.type === TextArea);
  const control = describable
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        "aria-invalid": error ? true : undefined,
        "aria-describedby": message ? messageId : undefined,
        "aria-required": required ? true : undefined,
      })
    : children;

  return (
    <div className={className}>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {label}
          {required && (
            <span aria-hidden className="text-destructive">
              {" "}
              *
            </span>
          )}
        </span>
        {control}
      </label>
      {message && (
        <p
          id={messageId}
          role={error ? "alert" : undefined}
          className={cn("mt-1 text-xs", error ? "text-destructive" : "text-muted-foreground")}
        >
          {message}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Diálogos                                                            */
/* ------------------------------------------------------------------ */

/**
 * Diálogo acessível (Radix): `role="dialog"`, foco preso e devolvido, Escape,
 * bloqueio do scroll. Em mobile abre como folha a partir de baixo.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Texto para leitores de ecrã; por omissão repete o título. */
  description?: string;
  children: ReactNode;
  className?: string;
  size?: "md" | "lg";
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-popover p-5 text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-8 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-6 sm:data-[state=open]:slide-in-from-bottom-0",
            size === "lg" ? "sm:max-w-3xl" : "sm:max-w-lg",
            className,
          )}
        >
          <DialogPrimitive.Title className="pr-10 text-lg font-semibold">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {description ?? title}
          </DialogPrimitive.Description>
          <DialogPrimitive.Close asChild>
            <IconButton label="Fechar" className="absolute right-3 top-3">
              <X aria-hidden className="h-5 w-5" />
            </IconButton>
          </DialogPrimitive.Close>
          <div className="mt-4">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Ação destrutiva: botão de confirmação a vermelho. */
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

/** `const confirm = useConfirm(); if (!(await confirm({ title: "…" }))) return;` */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

/** Substitui `window.confirm`: acessível, em PT-PT e com contexto da ação. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{
    options: ConfirmOptions;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) => new Promise<boolean>((resolve) => setPending({ options, resolve })),
    [],
  );

  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const o = pending?.options;
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialogPrimitive.Root open={!!pending} onOpenChange={(next) => !next && settle(false)}>
        <AlertDialogPrimitive.Portal>
          <AlertDialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <AlertDialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=open]:zoom-in-95">
            <AlertDialogPrimitive.Title className="text-lg font-semibold">
              {o?.title}
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="mt-2 text-sm text-muted-foreground">
              {o?.description ?? "Esta ação não pode ser anulada."}
            </AlertDialogPrimitive.Description>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialogPrimitive.Cancel asChild>
                <Button variant="outline">{o?.cancelLabel ?? "Cancelar"}</Button>
              </AlertDialogPrimitive.Cancel>
              <AlertDialogPrimitive.Action asChild>
                <Button
                  variant={o?.destructive ? "destructive" : "primary"}
                  onClick={() => settle(true)}
                >
                  {o?.confirmLabel ?? "Confirmar"}
                </Button>
              </AlertDialogPrimitive.Action>
            </div>
          </AlertDialogPrimitive.Content>
        </AlertDialogPrimitive.Portal>
      </AlertDialogPrimitive.Root>
    </ConfirmContext.Provider>
  );
}
