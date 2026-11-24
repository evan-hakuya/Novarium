import { useQuery } from "@tanstack/react-query";
import { fetchHealth } from "@/api/health";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function HomePage() {
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });

  return (
    <Card>
      <CardHeader>
        <CardTitle>书库</CardTitle>
        <CardDescription>书库还是空的。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">服务状态</span>
        {health.isPending && <Badge variant="outline">检查中</Badge>}
        {health.isError && <Badge variant="destructive">无法连接</Badge>}
        {health.data && (
          <>
            <Badge variant={health.data.ok ? "default" : "destructive"}>
              {health.data.ok ? "正常" : "异常"}
            </Badge>
            <Badge variant="outline">运行环境：{health.data.runtime}</Badge>
            <Badge variant="outline">数据库：{health.data.checks.db}</Badge>
            <Badge variant="outline">存储：{health.data.checks.storage}</Badge>
          </>
        )}
      </CardContent>
    </Card>
  );
}
