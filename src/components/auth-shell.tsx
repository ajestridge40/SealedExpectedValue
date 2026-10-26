import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      {footer ? <div className="text-center text-sm text-muted">{footer}</div> : null}
    </div>
  );
}
