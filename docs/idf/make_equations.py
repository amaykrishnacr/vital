"""Render the IDF equations as PNG images (STIX serif, like the template's equations)."""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

matplotlib.rcParams["mathtext.fontset"] = "stix"
matplotlib.rcParams["font.family"] = "STIXGeneral"

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "img", "eq")
os.makedirs(OUT, exist_ok=True)

EQS = {
    "hr": r"$HR=\dfrac{60}{\overline{\Delta t}}$",
    "ratio": r"$R=\dfrac{AC_{red}\,/\,DC_{red}}{AC_{ir}\,/\,DC_{ir}}$",
    "temp": r"$T_{body}=T_{skin}+\delta_u,\qquad \delta_u=T_{ref}-\overline{T}_{skin}$",
    "quality": r"$PI=100\cdot\dfrac{P_{95}-P_{5}}{\bar{x}},\qquad \rho=\dfrac{\sigma(\Delta^{2}x)}{P_{95}-P_{5}},\qquad |\Delta HR|$",
    "features": r"$\mathbf{f}=\left[\,\overline{HR},\ \sigma_{HR},\ HR_{max}-HR_{min},\ \overline{SpO_2},\ \overline{T}_{body}\,\right]$",
    "z": r"$z_k=\dfrac{|x_k-m_k|}{\max(1.4826\cdot MAD_k,\ s_{k,min})},\qquad s_z=\sigma\!\left(1.5\,(z_{max}-4.5)\right)$",
    "sif": r"$s_{IF}=\sigma\!\left(3\cdot\dfrac{r-r_{99}}{r_{99}-r_{50}}\right)$",
    "s": r"$s=\max\left(s_z,\ s_{IF},\ 0.9\cdot s_{pop}\right)$",
    "steady": r"$\min\left(d\,b_{old},\ d\,b_{new}\right)\ \geq\ 0.5\,d\,b$",
    "cross": r"$t_{cross}=\dfrac{L-a}{b}$",
}

for name, tex in EQS.items():
    fig = plt.figure(figsize=(0.01, 0.01))
    fig.text(0, 0, tex, fontsize=13)
    path = os.path.join(OUT, f"{name}.png")
    fig.savefig(path, dpi=300, bbox_inches="tight", pad_inches=0.03, transparent=False, facecolor="white")
    plt.close(fig)
    print(path)
