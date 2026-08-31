export const TEMPLATES: Record<string, { description: string; content: string }> = {
  deployment: {
    description: "Kubernetes Deployment",
    content: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{name}}
  namespace: {{namespace}}
spec:
  replicas: {{replicas}}
  selector:
    matchLabels:
      app: {{name}}
  template:
    metadata:
      labels:
        app: {{name}}
    spec:
      containers:
        - name: {{name}}
          image: {{image}}
          ports:
            - containerPort: {{port}}`,
  },
  service: {
    description: "Kubernetes Service",
    content: `apiVersion: v1
kind: Service
metadata:
  name: {{name}}
  namespace: {{namespace}}
spec:
  selector:
    app: {{name}}
  ports:
    - port: {{port}}
      targetPort: {{port}}
  type: ClusterIP`,
  },
  route: {
    description: "OpenShift Route",
    content: `apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: {{name}}
  namespace: {{namespace}}
spec:
  to:
    kind: Service
    name: {{name}}
  port:
    targetPort: {{port}}
  tls:
    termination: edge`,
  },
  configmap: {
    description: "Kubernetes ConfigMap",
    content: `apiVersion: v1
kind: ConfigMap
metadata:
  name: {{name}}
  namespace: {{namespace}}
data:
  {{key}}: {{value}}`,
  },
  pvc: {
    description: "Kubernetes PersistentVolumeClaim",
    content: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{name}}
  namespace: {{namespace}}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: {{size}}`,
  },
}
