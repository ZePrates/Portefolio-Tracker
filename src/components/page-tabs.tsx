import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface PageTab<T extends string> {
  id: T;
  label: string;
  content: ReactNode;
}

/**
 * Separadores de uma página (Radix: setas, Home/End, `role="tablist"`).
 * Só o separador ativo é montado, por isso as queries dos outros não correm.
 * O separador ativo vive no URL (`?tab=`), para os links e o "voltar" funcionarem.
 */
export function PageTabs<T extends string>({
  value,
  onChange,
  tabs,
  label,
  className,
}: {
  value: T;
  onChange: (tab: T) => void;
  tabs: PageTab<T>[];
  /** Nome do grupo de separadores para leitores de ecrã. */
  label: string;
  className?: string;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(v) => onChange(v as T)}
      className={cn("space-y-5", className)}
    >
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <TabsList aria-label={label} className="h-auto gap-1 bg-secondary p-1">
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="min-h-9 px-3.5">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id} className="mt-0 space-y-6">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
