import { Bell, Building2, CalendarDays, CheckCircle2, CircleDollarSign, ClipboardList, CreditCard, LayoutDashboard, Mail, Pencil, Phone, Search, UsersRound, WalletCards } from "lucide-react";
import "./_group.css";

export const residents = [
  { id:1,name:"Jordan Lee",email:"jordan.lee@email.com",phone:"(555) 014-2388",home:"Northside House",moveIn:"Oct 03, 2024",status:"active",balance:420,notes:"Checking in with mentor weekly." },
  { id:2,name:"Marcus Williams",email:"marcus.w@email.com",phone:"(555) 014-8821",home:"Northside House",moveIn:"Sep 18, 2024",status:"active",balance:0,notes:"Next payment due October 20." },
  { id:3,name:"Tanya Brooks",email:"tanya.b@email.com",phone:"(555) 014-4410",home:"Eastlake House",moveIn:"Oct 12, 2024",status:"pending",balance:0,notes:"Move-in preparation" },
  { id:4,name:"Devon Carter",email:"devon.c@email.com",phone:"(555) 014-1974",home:"Northside House",moveIn:"Aug 02, 2024",status:"active",balance:180,notes:"Payment plan in place." },
];
export const payments = [
  {id:1,residentId:1,resident:"Jordan Lee",date:"Oct 15, 2024",amount:420,status:"due",method:"Payment not recorded"},
  {id:2,residentId:2,resident:"Marcus Williams",date:"Oct 20, 2024",amount:600,status:"paid",method:"Bank transfer"},
  {id:3,residentId:4,resident:"Devon Carter",date:"Oct 05, 2024",amount:480,status:"overdue",method:"Payment plan"},
  {id:4,residentId:3,resident:"Tanya Brooks",date:"Oct 25, 2024",amount:550,status:"due",method:"Payment not recorded"},
];
export const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(n);

export function Shell({active,children}:{active:string;children:React.ReactNode}){
 const nav=[["Overview","/",LayoutDashboard],["Residents","/residents",UsersRound],["Payments","/payments",CreditCard]] as const;
 return <div className="rho"><div className="rho-shell"><aside className="rho-sidebar">
  <a href="#" style={{display:"flex",alignItems:"center",gap:12,padding:"0 12px"}}><span style={{display:"grid",placeItems:"center",width:40,height:40,borderRadius:12,background:"hsl(165 48% 67%)",color:"hsl(195 32% 18%)"}}><Building2 size={20}/></span><span><b style={{display:"block",fontSize:15}}>Harbor House</b><small style={{fontSize:10,letterSpacing:".18em",opacity:.55}}>OPERATIONS</small></span></a>
  <div className="rho-kicker" style={{margin:"40px 12px 10px",color:"hsl(41 37% 92%/.4)"}}>Workspace</div>{nav.map(([label,href,Icon])=><a key={label} href={href} className={`rho-nav ${active===label?"active":""}`}><Icon size={18}/>{label}{active===label&&<i style={{marginLeft:"auto",width:6,height:6,borderRadius:99,background:"hsl(165 48% 67%)"}}/>}</a>)}
  <div className="rho-sidebar-spacer"/><div style={{border:"1px solid hsl(195 26% 31%)",borderRadius:16,padding:16,background:"hsl(195 26% 29%/.5)"}}><b style={{fontSize:12}}>● System healthy</b><p style={{fontSize:11,lineHeight:1.6,opacity:.55,margin:"8px 0 0"}}>All resident and payment records are up to date.</p></div><div style={{borderTop:"1px solid hsl(195 26% 31%)",marginTop:16,padding:"16px 12px 0",display:"flex",gap:12}}><span style={{display:"grid",placeItems:"center",width:32,height:32,borderRadius:"50%",background:"hsl(14 72% 63%)",fontSize:12,fontWeight:800}}>AM</span><span><b style={{fontSize:12}}>Alex Morgan</b><small style={{display:"block",fontSize:10,opacity:.5}}>House coordinator</small></span></div>
 </aside><main className="rho-main"><header className="rho-topbar"><span className="rho-muted" style={{fontSize:12,fontWeight:700}}>Tuesday, October 15, 2024　/　Morning check-in</span><span style={{display:"flex",gap:16,alignItems:"center"}}><Bell size={18} className="rho-muted"/><span className="rho-muted" style={{fontSize:12,fontWeight:700}}>Harbor House · Northside</span></span></header><div className="rho-content">{children}</div></main></div></div>
}
export function Status({value}:{value:string}){const colors:any={active:["#dceee9","#28615a"],pending:["#f6e9c9","#885d28"],paid:["#dceee9","#28615a"],due:["#f6e9c9","#885d28"],overdue:["#fae2dc","#914b3d"]};const c=colors[value]||colors.active;return <span style={{background:c[0],color:c[1],borderRadius:99,padding:"5px 9px",fontSize:10,fontWeight:800,textTransform:"capitalize"}}>{value}</span>}
export function Metric({icon:Icon,label,value,note,color}:{icon:any;label:string;value:string|number;note:string;color:string}){return <div className="rho-card" style={{padding:20}}><div style={{display:"flex",justifyContent:"space-between"}}><span className="rho-kicker" style={{maxWidth:130}}>{label}</span><span style={{display:"grid",placeItems:"center",width:36,height:36,borderRadius:12,background:color}}><Icon size={18}/></span></div><b style={{display:"block",fontSize:30,marginTop:16}}>{value}</b><small className="rho-muted">{note}</small></div>}
export const IconSet={Bell,CalendarDays,CheckCircle2,CircleDollarSign,ClipboardList,CreditCard,Mail,Pencil,Phone,Search,UsersRound,WalletCards};