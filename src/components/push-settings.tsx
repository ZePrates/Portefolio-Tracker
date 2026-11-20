import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellOff, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui-bits";
import {
  deletePushSubscription,
  getPushStatus,
  savePushSubscription,
  sendPushNow,
} from "@/lib/push.functions";
import {
  currentSubscription,
  pushSupport,
  registerPushWorker,
  serializeSubscription,
  urlBase64ToUint8Array,
} from "@/lib/push-client";
import { formatDatePt } from "@/lib/format";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Não foi possível concluir.");

/** Ativar/desativar o resumo das 9h neste dispositivo e enviar uma notificação de teste. */
export function PushSettings() {
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getPushStatus);
  const save = useServerFn(savePushSubscription);
  const remove = useServerFn(deletePushSubscription);
  const sendNow = useServerFn(sendPushNow);

  const support = pushSupport();
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "n/a">(() =>
    typeof Notification === "undefined" ? "n/a" : Notification.permission,
  );

  const status = useQuery({ queryKey: ["push-status"], queryFn: () => fetchStatus() });

  useEffect(() => {
    void currentSubscription().then((s) => setEndpoint(s?.endpoint ?? null));
  }, []);

  const registered = !!endpoint && !!status.data?.devices.some((d) => d.endpoint === endpoint);
  const thisDevice = status.data?.devices.find((d) => d.endpoint === endpoint);

  const enable = useMutation({
    mutationFn: async () => {
      const key = status.data?.publicKey;
      if (!key) throw new Error("As notificações ainda não estão configuradas no servidor.");
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        throw new Error(
          "Permissão recusada. Ativa as notificações do site nas definições do Chrome.",
        );
      }
      const reg = await registerPushWorker();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        }));
      await save({ data: serializeSubscription(sub) });
      setEndpoint(sub.endpoint);
      await sendNow({ data: { kind: "test" } });
    },
    onSuccess: () => {
      toast.success("Notificações ativas neste dispositivo. Enviei uma de teste.");
      void queryClient.invalidateQueries({ queryKey: ["push-status"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const disable = useMutation({
    mutationFn: async () => {
      const sub = await currentSubscription();
      if (sub) {
        await remove({ data: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setEndpoint(null);
    },
    onSuccess: () => {
      toast.success("Notificações desativadas neste dispositivo.");
      void queryClient.invalidateQueries({ queryKey: ["push-status"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const preview = useMutation({
    mutationFn: () => sendNow({ data: { kind: "digest" } }),
    onSuccess: () => toast.success("Resumo de hoje enviado para os teus dispositivos."),
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Nos dias úteis, às 9h, recebes um resumo: variação do último fecho, ativos que caíram 5 % ou
        mais, os que passaram para baixo do preço médio, dividendos dos próximos dias e avisos de
        dados. Só percentagens, sem valores em euros (aparece no ecrã bloqueado).
      </p>

      {support !== "supported" ? (
        <p className="rounded-lg border border-border bg-secondary px-3 py-2">
          {support === "insecure"
            ? "As notificações só funcionam no endereço seguro (https) da app."
            : "Este browser não suporta notificações push. No Android, usa o Chrome."}
        </p>
      ) : status.isLoading ? (
        <p className="text-muted-foreground">A verificar…</p>
      ) : !status.data?.publicKey ? (
        <p className="rounded-lg border border-border bg-secondary px-3 py-2">
          Ainda não configurado: faltam as chaves VAPID na Vercel.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {registered ? (
              <Bell aria-hidden className="h-4 w-4 text-primary" />
            ) : (
              <BellOff aria-hidden className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-medium">
              {registered ? "Ativas neste dispositivo" : "Desativadas neste dispositivo"}
            </span>
          </div>
          {thisDevice?.last_success_at && (
            <p className="text-xs text-muted-foreground">
              Último envio: {formatDatePt(thisDevice.last_success_at)}
            </p>
          )}
          {permission === "denied" && (
            <p className="text-xs text-destructive">
              O Chrome está a bloquear as notificações deste site. Desbloqueia em Definições do site
              → Notificações.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {registered ? (
              <>
                <Button
                  variant="outline"
                  loading={preview.isPending}
                  onClick={() => preview.mutate()}
                >
                  <Send aria-hidden className="h-4 w-4" />
                  Enviar o resumo de hoje
                </Button>
                <Button
                  variant="ghost"
                  loading={disable.isPending}
                  onClick={() => disable.mutate()}
                >
                  Desativar
                </Button>
              </>
            ) : (
              <Button loading={enable.isPending} onClick={() => enable.mutate()}>
                <Bell aria-hidden className="h-4 w-4" />
                Ativar notificações
              </Button>
            )}
          </div>
          {(status.data?.devices.length ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              Dispositivos com notificações: {status.data!.devices.length}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
