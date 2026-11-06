import { request } from "./client";
import type { Project } from "./types";

export const listProjects = () => request<Project[]>("/projects");
